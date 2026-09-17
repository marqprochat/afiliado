import pino from 'pino';
import { prisma } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import { isEligibleProduct, isEligibleCoupon, isWithinOperatingWindow } from '@afilados/core';
import { enqueueSendOffer } from '../lib/queue-helpers';
import { discoverForRule } from './discovery';

const log = pino({ name: 'automation-scheduler' });

export interface AutomationSchedulerDeps {
  enqueue?: (tenantId: string, batchItemId: string) => Promise<void>;
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
  private readonly discover: (rule: AutomationRule) => Promise<void>;
  private readonly now: () => Date;

  constructor(deps: AutomationSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? ((tenantId, batchItemId) => enqueueSendOffer(tenantId, batchItemId));
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

    const lastDispatch = await prisma.automationLog.findFirst({
      where: { ruleId: rule.id, action: 'DISPATCHED' },
      orderBy: { createdAt: 'desc' },
    });
    if (lastDispatch) {
      const elapsedMin = (now.getTime() - lastDispatch.createdAt.getTime()) / 60_000;
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
      const manual = await prisma.automationQueueItem.findFirst({
        where: { ruleId: rule.id, manual: true, status: 'PENDING' },
        orderBy: { addedAt: 'asc' },
        include: { product: true, coupon: true },
      });

      let candidate = manual;
      if (!candidate) {
        if (!discovered) {
          await this.discover(rule);
          discovered = true;
        }
        candidate = await prisma.automationQueueItem.findFirst({
          where: { ruleId: rule.id, manual: false, status: 'PENDING' },
          orderBy: { addedAt: 'asc' },
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
