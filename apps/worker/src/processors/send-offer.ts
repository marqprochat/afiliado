import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  generateSubId,
  isWithinOperatingWindow,
  nextWindowOpen,
  renderTemplate,
} from '@afilados/core';
import type { MarketplaceAdapter, ShopeeCredentials } from '@afilados/marketplaces';
import type { ProductData, SendOfferJob } from '@afilados/shared';
import { publishEvent } from '../lib/events';
import { getRedis } from '../lib/redis';
import { TokenBucket, jitter, waitForToken } from '../lib/rate-limit';
import type { OutgoingMessage, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'send-offer' });

export interface SendOfferDeps {
  gateway: WhatsAppGateway;
  shopee: MarketplaceAdapter<ShopeeCredentials>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  bucketFor?: (sessionId: string, ratePerMin: number) => { take(): Promise<number> };
}

export type SendOfferResult =
  | { outcome: 'sent'; groups: number }
  | { outcome: 'skipped'; reason: 'batch-inactive' | 'missing' }
  | { outcome: 'rescheduled'; runAt: Date };

const GROUP_GAP_MS = 4_000;

export async function sendOffer(
  deps: SendOfferDeps,
  batchItemId: string,
): Promise<SendOfferResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rng = deps.rng ?? Math.random;
  const bucketFor =
    deps.bucketFor ??
    ((sessionId: string, rate: number) =>
      new TokenBucket(getRedis(), `wa:rate:${sessionId}`, rate));

  const item = await prisma.batchItem.findUnique({
    where: { id: batchItemId },
    include: { product: true, batch: { include: { template: true, session: true } } },
  });
  if (!item) return { outcome: 'skipped', reason: 'missing' };
  const { batch, product } = item;
  if (batch.status === 'PAUSED' || batch.status === 'CANCELLED' || batch.status === 'DONE') {
    return { outcome: 'skipped', reason: 'batch-inactive' };
  }
  if (item.status === 'SENT') return { outcome: 'skipped', reason: 'missing' };
  const tenantId = batch.tenantId;

  const [windowRow, settingsRows, conn] = await Promise.all([
    prisma.operatingWindow.findUnique({ where: { tenantId } }),
    prisma.setting.findMany({ where: { tenantId } }),
    prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'SHOPEE' } }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value])) as Record<
    string,
    unknown
  >;
  const ratePerMin = Number(settings.globalRateLimitPerMin ?? 6);
  const subIdPattern = String(settings.subIdPattern ?? '{yyyyMMdd}-{batchId}');
  const window = windowRow
    ? {
        startTime: windowRow.startTime,
        endTime: windowRow.endTime,
        timezone: windowRow.timezone,
        enabled: windowRow.enabled,
      }
    : { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };

  const t = now();
  if (!isWithinOperatingWindow(t, window)) {
    const runAt = nextWindowOpen(t, window);
    await prisma.batchItem.update({ where: { id: item.id }, data: { runAt } });
    const last = await prisma.batchItem.findFirst({
      where: { batchId: batch.id },
      orderBy: { runAt: 'desc' },
    });
    await prisma.batch.update({
      where: { id: batch.id },
      data: { estimatedEndAt: last?.runAt ?? runAt },
    });
    await publishProgress(batch.id, tenantId);
    return { outcome: 'rescheduled', runAt };
  }

  await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'SENDING' } });
  if (batch.status === 'SCHEDULED')
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'RUNNING' } });

  try {
    // Link de afiliado (uma vez por item)
    let affiliateLink = product.originalUrl;
    if (product.source === 'SHOPEE' && conn?.encryptedCredentials) {
      const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
      const subId = generateSubId(subIdPattern, {
        now: t,
        batchId: batch.id,
        timezone: window.timezone,
      });
      affiliateLink = await deps.shopee.toAffiliateLink(creds, product.originalUrl, subId);
    }

    const pd: ProductData = {
      source: product.source,
      title: product.title,
      price: Number(product.price),
      images: product.images,
      shipping: product.shipping,
      originalUrl: product.originalUrl,
      raw: product.raw,
      ...(product.externalId ? { externalId: product.externalId } : {}),
      ...(product.originalPrice !== null ? { originalPrice: Number(product.originalPrice) } : {}),
      ...(product.discountPct !== null ? { discountPct: product.discountPct } : {}),
      ...(product.salesCount !== null ? { salesCount: product.salesCount } : {}),
      ...(product.commissionPct !== null ? { commissionPct: Number(product.commissionPct) } : {}),
      ...(product.flashSaleEndsAt
        ? { flashSaleEndsAt: product.flashSaleEndsAt.toISOString() }
        : {}),
      ...(product.couponCode ? { couponCode: product.couponCode } : {}),
      ...(product.couponValue !== null ? { couponValue: Number(product.couponValue) } : {}),
    };
    const text = renderTemplate(batch.template.body, pd, { affiliateLink, now: t.toISOString() });
    const image = product.images[0];
    const message: OutgoingMessage =
      batch.mediaMode === 'IMAGE' && image
        ? { kind: 'image', imageUrl: image, caption: text }
        : {
            kind: 'preview',
            text,
            title: product.title,
            description: `R$ ${Number(product.price).toFixed(2).replace('.', ',')}`,
            thumbnailUrl: image ?? '',
            url: affiliateLink,
          };

    const existing = await prisma.sendLog.findMany({
      where: { batchItemId: item.id, waMessageId: { not: null } },
    });
    const done = new Set(existing.map((l) => l.groupJid));
    const bucket = bucketFor(batch.sessionId, ratePerMin);
    let sentCount = 0;
    let first = true;
    for (const groupJid of batch.groupJids) {
      if (done.has(groupJid)) continue;
      if (!first) await sleep(jitter(GROUP_GAP_MS, 0.15, rng));
      first = false;
      await waitForToken(bucket, sleep);
      try {
        const { messageId } = await deps.gateway.sendMessage(batch.sessionId, groupJid, message);
        await prisma.sendLog.upsert({
          where: { batchItemId_groupJid: { batchItemId: item.id, groupJid } },
          update: { waMessageId: messageId, status: 'SENT', error: null, sentAt: now() },
          create: {
            tenantId,
            batchItemId: item.id,
            groupJid,
            waMessageId: messageId,
            status: 'SENT',
          },
        });
        sentCount++;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log.warn({ batchItemId: item.id, groupJid, error }, 'falha ao enviar');
        await prisma.sendLog.upsert({
          where: { batchItemId_groupJid: { batchItemId: item.id, groupJid } },
          update: { status: 'ERROR', error, sentAt: now() },
          create: { tenantId, batchItemId: item.id, groupJid, status: 'ERROR', error },
        });
      }
    }

    const anySent = sentCount > 0 || done.size > 0;
    const status = anySent ? 'SENT' : 'ERROR';
    await prisma.batchItem.update({
      where: { id: item.id },
      data: { status, error: anySent ? null : 'nenhum grupo recebeu' },
    });
    await prisma.queueItem.updateMany({
      where: { tenantId, productId: product.id },
      data: { status },
    });
    await publishEvent(tenantId, {
      type: 'batch.item',
      batchId: batch.id,
      itemId: item.id,
      status,
    });

    await finalizeBatchIfComplete(batch.id);
    await publishProgress(batch.id, tenantId);
    return { outcome: 'sent', groups: sentCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.batchItem.update({
      where: { id: item.id },
      data: { status: 'ERROR', error },
    });
    await prisma.queueItem.updateMany({
      where: { tenantId, productId: product.id },
      data: { status: 'ERROR' },
    });
    await publishEvent(tenantId, {
      type: 'batch.item',
      batchId: batch.id,
      itemId: item.id,
      status: 'ERROR',
    });
    await finalizeBatchIfComplete(batch.id);
    await publishProgress(batch.id, tenantId);
    throw e;
  }
}

/**
 * Marca o lote como DONE quando não há mais itens pendentes/enviando.
 * Nunca sobrescreve CANCELLED/PAUSED: só transiciona a partir de SCHEDULED/RUNNING.
 */
export async function finalizeBatchIfComplete(batchId: string) {
  const remaining = await prisma.batchItem.count({
    where: { batchId, status: { in: ['PENDING', 'SENDING'] } },
  });
  if (remaining === 0) {
    await prisma.batch.updateMany({
      where: { id: batchId, status: { in: ['SCHEDULED', 'RUNNING'] } },
      data: { status: 'DONE' },
    });
  }
}

async function publishProgress(batchId: string, tenantId: string) {
  const b = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { items: { select: { status: true } } },
  });
  if (!b) return;
  await publishEvent(tenantId, {
    type: 'batch.progress',
    batchId,
    sent: b.items.filter((i) => i.status === 'SENT').length,
    total: b.items.length,
    estimatedEndAt: (b.estimatedEndAt ?? new Date()).toISOString(),
  });
}

export function processSendOffer(deps: SendOfferDeps) {
  return async (job: Job<SendOfferJob>) => {
    const r = await sendOffer(deps, job.data.batchItemId);
    if (r.outcome === 'rescheduled') {
      const delay = Math.max(1_000, r.runAt.getTime() - Date.now());
      await job.moveToDelayed(Date.now() + delay, job.token);
      throw new DelayedError();
    }
  };
}
