import pino from 'pino';
import { prisma } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import { isEligibleProduct, isEligibleCoupon, isWithinOperatingWindow } from '@afilados/core';
import type { SendTelegramJob } from '@afilados/shared';
import { enqueueSendOffer, enqueueSendTelegram } from '../lib/queue-helpers';
import { discoverForRule } from './discovery';

const log = pino({ name: 'automation-scheduler' });

export interface AutomationSchedulerDeps {
  enqueue?: (tenantId: string, batchItemId: string) => Promise<void>;
  enqueueTelegram?: (job: SendTelegramJob & { jobId: string }) => Promise<void>;
  /** Dispara a descoberta (busca por keyword) e popula AutomationQueueItem para a regra. */
  discover?: (rule: AutomationRule) => Promise<void>;
  now?: () => Date;
}

/** Número máximo de candidatos testados por regra em uma única rodada de despacho. */
const MAX_DISPATCH_ATTEMPTS = 10;

export class AutomationScheduler {
  private rules: AutomationRule[] = [];
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly enqueue: (tenantId: string, batchItemId: string) => Promise<void>;
  private readonly enqueueTelegram: (job: SendTelegramJob & { jobId: string }) => Promise<void>;
  private readonly discover: (rule: AutomationRule) => Promise<void>;
  private readonly now: () => Date;

  constructor(deps: AutomationSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? ((tenantId, batchItemId) => enqueueSendOffer(tenantId, batchItemId));
    this.enqueueTelegram = deps.enqueueTelegram ?? ((job) => enqueueSendTelegram(job));
    this.discover = deps.discover ?? ((rule) => discoverForRule(rule));
    this.now = deps.now ?? (() => new Date());
  }

  async start() {
    await this.reload();
    this.timer = setInterval(() => {
      void this.tick().catch((e) => log.error(e, 'falha no tick de automação'));
    }, 30_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reload() {
    this.rules = await prisma.automationRule.findMany({ where: { enabled: true } });
  }

  ruleCount() {
    return this.rules.length;
  }

  ruleNames() {
    return this.rules.map((r) => r.name);
  }

  async tick() {
    if (this.ticking) {
      log.warn('tick anterior ainda em andamento, pulando esta execução');
      return;
    }
    this.ticking = true;
    try {
      for (const rule of this.rules) {
        await this.tickRule(rule).catch((e) =>
          log.error({ ruleId: rule.id, err: e }, 'falha ao processar regra de automação'),
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  isTicking() {
    return this.ticking;
  }

  private async tickRule(rule: AutomationRule) {
    const now = this.now();

    // Gate por QUALQUER log da regra (não só DISPATCHED): uma regra que nunca despacha com
    // sucesso (todo candidato inelegível, ou descoberta sempre vazia) ainda assim precisa
    // respeitar o intervalMin — senão dispara discoverForRule a cada tick de 30s, o que para
    // Mercado Livre/Magalu significa até 20 fetches autenticados por rodada contra a sessão
    // real do usuário (ver Critical #1 da revisão final do Plano 2/3).
    const lastLog = await prisma.automationLog.findFirst({
      where: { ruleId: rule.id },
      orderBy: { createdAt: 'desc' },
    });
    if (lastLog) {
      const elapsedMin = (now.getTime() - lastLog.createdAt.getTime()) / 60_000;
      if (elapsedMin < rule.intervalMin) return;
    }

    const window = await prisma.operatingWindow.findUnique({ where: { tenantId: rule.tenantId } });
    if (
      window &&
      !isWithinOperatingWindow(now, {
        startTime: window.startTime,
        endTime: window.endTime,
        timezone: window.timezone,
        enabled: window.enabled,
      })
    ) {
      return;
    }

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const dispatchedToday = await prisma.automationLog.count({
      where: { ruleId: rule.id, action: 'DISPATCHED', createdAt: { gte: startOfDay } },
    });
    if (dispatchedToday >= rule.maxOffersPerDay) return;

    await this.dispatchNext(rule);
  }

  private async dispatchNext(rule: AutomationRule) {
    // Descoberta é disparada no máximo uma vez por rodada de despacho: evita bater na
    // API da Shopee repetidamente enquanto tentamos os próximos candidatos elegíveis.
    let discovered = false;

    for (let attempt = 0; attempt < MAX_DISPATCH_ATTEMPTS; attempt++) {
      // Gatilho da descoberta preservado do comportamento original: só dispara quando não há
      // NENHUM item manual pendente nesta rodada (mesmo que já existam itens automáticos na
      // fila) — no máximo uma vez por chamada de dispatchNext, via a flag `discovered`.
      if (!discovered) {
        const hasManualPending = await prisma.automationQueueItem.count({
          where: { ruleId: rule.id, manual: true, status: 'PENDING' },
        });
        if (hasManualPending === 0) {
          await this.discover(rule);
          discovered = true;
        }
      }

      // Escolha do candidato: sempre pela ordem da fila (position), manual ou automático —
      // é a ordem que o usuário vê e reorganiza no painel.
      const candidate = await prisma.automationQueueItem.findFirst({
        where: { ruleId: rule.id, status: 'PENDING' },
        orderBy: { position: 'asc' },
        include: { product: true, coupon: true },
      });

      if (!candidate) {
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: rule.marketplaces[0] ?? 'SHOPEE',
            action: 'SKIPPED',
            reason: 'nenhum produto elegível encontrado',
          },
        });
        return;
      }

      const productMarketplace =
        candidate.product && candidate.product.source !== 'MANUAL' ? candidate.product.source : undefined;
      const marketplaceForLog = productMarketplace ?? candidate.coupon?.store ?? rule.marketplaces[0]!;

      if (candidate.kind === 'PRODUCT') {
        if (!candidate.product) {
          await prisma.automationQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'REMOVED' },
          });
          continue;
        }
        const elig = isEligibleProduct({
          title: candidate.product.title,
          price: Number(candidate.product.price),
          images: candidate.product.images,
          originalUrl: candidate.product.originalUrl,
          raw: candidate.product.raw as Record<string, unknown>,
        });
        if (!elig.ok) {
          await prisma.automationQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'REMOVED' },
          });
          await prisma.automationLog.create({
            data: {
              tenantId: rule.tenantId,
              ruleId: rule.id,
              marketplace: marketplaceForLog,
              action: 'SKIPPED',
              productId: candidate.productId,
              reason: elig.reason,
            },
          });
          continue;
        }
      } else {
        if (!candidate.coupon) {
          await prisma.automationQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'REMOVED' },
          });
          continue;
        }
        const elig = isEligibleCoupon({
          code: candidate.coupon.code,
          expiresAt: candidate.coupon.expiresAt?.toISOString() ?? null,
        });
        if (!elig.ok) {
          await prisma.automationQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'REMOVED' },
          });
          await prisma.automationLog.create({
            data: {
              tenantId: rule.tenantId,
              ruleId: rule.id,
              marketplace: marketplaceForLog,
              action: 'SKIPPED',
              reason: elig.reason,
            },
          });
          continue;
        }
      }

      const batchTemplateId = candidate.kind === 'COUPON' ? candidate.templateId ?? rule.templateId : rule.templateId;

      const batch = await prisma.batch.create({
        data: {
          tenantId: rule.tenantId,
          sessionId: rule.sessionId,
          templateId: batchTemplateId,
          name: `Automação: ${rule.name}`,
          groupJids: rule.groupJids,
          intervalMin: rule.intervalMin,
          mediaMode: rule.mediaMode,
          items: {
            create: [
              {
                order: 0,
                runAt: this.now(),
                productId: candidate.kind === 'PRODUCT' ? candidate.productId : null,
                couponId: candidate.kind === 'COUPON' ? candidate.couponId : null,
              },
            ],
          },
        },
        include: { items: true },
      });

      try {
        await this.enqueue(rule.tenantId, batch.items[0]!.id);
        if (rule.telegramChatIds.length > 0) {
          for (const chatId of rule.telegramChatIds) {
            const bot = await prisma.telegramChat
              .findFirst({ where: { chatId }, select: { botId: true } })
              .catch(() => null);
            if (!bot) continue;
            await this.enqueueTelegram({
              jobId: `${batch.items[0]!.id}-${chatId}`,
              tenantId: rule.tenantId,
              botId: bot.botId,
              chatId,
              templateId: batchTemplateId,
              ...(candidate.kind === 'PRODUCT' && candidate.productId
                ? { productId: candidate.productId }
                : {}),
              ...(candidate.kind === 'COUPON' && candidate.couponId
                ? { couponId: candidate.couponId }
                : {}),
            }).catch((e) =>
              log.warn({ ruleId: rule.id, chatId, err: e }, 'falha ao enfileirar envio no telegram'),
            );
          }
        }
        await prisma.automationQueueItem.update({
          where: { id: candidate.id },
          data: { status: 'DISPATCHED', dispatchedAt: this.now() },
        });
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: marketplaceForLog,
            action: 'DISPATCHED',
            productId: candidate.productId,
          },
        });
      } catch (e) {
        await prisma.batch.update({ where: { id: batch.id }, data: { status: 'CANCELLED' } });
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: marketplaceForLog,
            action: 'ERROR',
            reason: e instanceof Error ? e.message : String(e),
          },
        });
      }
      return;
    }

    log.warn({ ruleId: rule.id }, 'limite de tentativas de despacho atingido nesta rodada');
  }
}
