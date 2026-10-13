import { prisma, type ProductSource } from '@afilados/db';
import { createTenantWithUser } from './helpers';

export interface MetricsCtx {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  sessionId: string;
  templateId: string;
}

export async function createMetricsTenant(name = 'metrics'): Promise<MetricsCtx> {
  const t = await createTenantWithUser(name);
  const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 'chip' } });
  const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
  return { ...t, sessionId: session.id, templateId: template.id };
}

export function addGroup(
  ctx: MetricsCtx,
  jid: string,
  opts: { name?: string; memberCount?: number; botIsAdmin?: boolean } = {},
) {
  return prisma.waGroup.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      jid,
      name: opts.name ?? jid,
      memberCount: opts.memberCount ?? 0,
      botIsAdmin: opts.botIsAdmin ?? true,
    },
  });
}

export function addSendLog(
  ctx: MetricsCtx,
  groupJid: string,
  sentAt: string,
  status: 'SENT' | 'ERROR' = 'SENT',
  extra: { batchItemId?: string; error?: string } = {},
) {
  return prisma.sendLog.create({
    data: {
      tenantId: ctx.tenantId,
      groupJid,
      status,
      sentAt: new Date(sentAt),
      ...(extra.batchItemId ? { batchItemId: extra.batchItemId } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    },
  });
}

function newBatch(ctx: MetricsCtx, groupJids: string[]) {
  return prisma.batch.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      templateId: ctx.templateId,
      name: 'metrics',
      groupJids,
      intervalMin: 1,
    },
  });
}

/** Produto enviado com sucesso para cada grupo de `groupJids` no instante `sentAt`. */
export async function addProductSend(
  ctx: MetricsCtx,
  opts: { source: ProductSource; title: string; groupJids: string[]; sentAt: string },
): Promise<{ productId: string; itemId: string }> {
  const product = await prisma.product.create({
    data: {
      tenantId: ctx.tenantId,
      source: opts.source,
      title: opts.title,
      price: 10,
      originalUrl: 'https://example.com/p',
      raw: {},
      images: ['https://example.com/i.jpg'],
    },
  });
  const batch = await newBatch(ctx, opts.groupJids);
  const item = await prisma.batchItem.create({
    data: {
      batchId: batch.id,
      productId: product.id,
      order: 0,
      runAt: new Date(opts.sentAt),
      status: 'SENT',
    },
  });
  for (const jid of opts.groupJids) {
    await addSendLog(ctx, jid, opts.sentAt, 'SENT', { batchItemId: item.id });
  }
  return { productId: product.id, itemId: item.id };
}

/** Cupom enviado com sucesso para um grupo. */
export async function addCouponSend(ctx: MetricsCtx, opts: { groupJid: string; sentAt: string }) {
  const coupon = await prisma.coupon.create({
    data: {
      tenantId: ctx.tenantId,
      store: 'SHOPEE',
      code: `C${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      description: 'cupom',
    },
  });
  const batch = await newBatch(ctx, [opts.groupJid]);
  const item = await prisma.batchItem.create({
    data: {
      batchId: batch.id,
      couponId: coupon.id,
      order: 0,
      runAt: new Date(opts.sentAt),
      status: 'SENT',
    },
  });
  await addSendLog(ctx, opts.groupJid, opts.sentAt, 'SENT', { batchItemId: item.id });
  return coupon;
}
