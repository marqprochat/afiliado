import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptJson, type Prisma } from '@afilados/db';
import { parseCouponsFromText } from '@afilados/core';
import type { AliexpressCredentials, AwinCredentials } from '@afilados/marketplaces';
import {
  ApiError,
  couponBulkSchema,
  couponInputSchema,
  couponListQuerySchema,
  couponParseSchema,
  couponVerifySchema,
  QUEUE_COUPON_SYNC,
  type CouponSyncJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { toApiCoupon, toApiCouponCheck } from '../lib/coupons';
import { getQueue, getQueueEvents } from '../lib/redis';

const idParam = z.object({ id: z.string().min(1) });

const STATUS_ORDER: Record<string, number> = {
  VALID: 0,
  UNVERIFIED: 1,
  INVALID: 2,
  EXPIRED: 3,
};

export async function couponsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/coupons', async (req) => {
    const q = couponListQuerySchema.parse(req.query);
    const where: Prisma.CouponWhereInput = {};
    if (q.store) where.store = q.store;
    if (q.origin) where.origin = q.origin;
    if (q.status) {
      where.status = q.status;
    } else if (!q.includeExpired) {
      where.status = { not: 'EXPIRED' };
    }
    if (q.q) {
      where.OR = [
        { code: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
        { advertiserName: { contains: q.q, mode: 'insensitive' } },
      ];
    }

    const coupons = await req.db.coupon.findMany({
      where,
      take: 500,
      orderBy: { fetchedAt: 'desc' },
    });

    const sorted = [...coupons].sort((a, b) => {
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      const aTime = a.expiresAt ? a.expiresAt.getTime() : Infinity;
      const bTime = b.expiresAt ? b.expiresAt.getTime() : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      const aFetched = a.fetchedAt ? a.fetchedAt.getTime() : 0;
      const bFetched = b.fetchedAt ? b.fetchedAt.getTime() : 0;
      return bFetched - aFetched;
    });

    return { coupons: sorted.map(toApiCoupon) };
  });

  app.post('/coupons', async (req, reply) => {
    const body = couponInputSchema.parse(req.body);
    try {
      const coupon = await req.db.coupon.create({
        // @ts-expect-error tenantId injetado por forTenant
        data: {
          store: body.store,
          scope: '',
          advertiserName: body.advertiserName ?? null,
          code: body.code,
          description: body.description,
          terms: body.terms ?? null,
          discountType: body.discountType ?? null,
          discountValue: body.discountValue !== undefined && body.discountValue !== null ? body.discountValue : null,
          minSpend: body.minSpend !== undefined && body.minSpend !== null ? body.minSpend : null,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          sourceUrl: body.sourceUrl ?? null,
          origin: 'MANUAL',
          status: 'VALID',
        },
      });
      await app.events.publish(req.tenantId, { type: 'coupons.updated' });
      return reply.status(201).send(toApiCoupon(coupon));
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw ApiError.conflict('Cupom já cadastrado para esta loja');
      }
      throw err;
    }
  });

  app.put('/coupons/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = couponInputSchema.parse(req.body);
    const existing = await req.db.coupon.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Cupom não encontrado');

    try {
      await req.db.coupon.updateMany({
        where: { id },
        data: {
          store: body.store,
          advertiserName: body.advertiserName ?? null,
          code: body.code,
          description: body.description,
          terms: body.terms ?? null,
          discountType: body.discountType ?? null,
          discountValue: body.discountValue !== undefined && body.discountValue !== null ? body.discountValue : null,
          minSpend: body.minSpend !== undefined && body.minSpend !== null ? body.minSpend : null,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          sourceUrl: body.sourceUrl ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw ApiError.conflict('Cupom já cadastrado para esta loja');
      }
      throw err;
    }

    await app.events.publish(req.tenantId, { type: 'coupons.updated' });
    const updated = await req.db.coupon.findFirst({ where: { id } });
    return toApiCoupon(updated!);
  });

  app.delete('/coupons/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const inUse = await req.db.batchItem.count({ where: { couponId: id } });
    if (inUse > 0) {
      throw ApiError.conflict('Cupom já usado em envios — marque como expirado');
    }
    const r = await req.db.coupon.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Cupom não encontrado');
    await app.events.publish(req.tenantId, { type: 'coupons.updated' });
    return reply.status(204).send();
  });

  app.post('/coupons/parse', async (req) => {
    const body = couponParseSchema.parse(req.body);
    const candidates = parseCouponsFromText(body.text, {
      ...(body.store ? { defaultStore: body.store } : {}),
    });

    let resultCandidates = candidates.map((c) => ({ ...c, exists: false }));
    if (candidates.length > 0) {
      const existing = await req.db.coupon.findMany({
        where: {
          OR: candidates.map((c) =>
            c.store ? { store: c.store, code: c.code } : { code: c.code },
          ),
        },
        select: { store: true, code: true },
      });
      const existingKeys = new Set(
        existing.flatMap((e) => [`${e.store}:${e.code}`, `*:${e.code}`]),
      );
      resultCandidates = candidates.map((c) => ({
        ...c,
        exists: c.store
          ? existingKeys.has(`${c.store}:${c.code}`)
          : existingKeys.has(`*:${c.code}`),
      }));
    }

    return { candidates: resultCandidates };
  });

  app.post('/coupons/bulk', async (req) => {
    const body = couponBulkSchema.parse(req.body);
    const toInsert = body.coupons.map((c) => ({
      tenantId: req.tenantId,
      store: c.store,
      scope: '',
      advertiserName: c.advertiserName ?? null,
      code: c.code,
      description: c.description,
      terms: c.terms ?? null,
      discountType: c.discountType ?? null,
      discountValue: c.discountValue !== undefined && c.discountValue !== null ? c.discountValue : null,
      minSpend: c.minSpend !== undefined && c.minSpend !== null ? c.minSpend : null,
      startsAt: c.startsAt ? new Date(c.startsAt) : null,
      expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
      sourceUrl: c.sourceUrl ?? null,
      origin: 'IMPORT' as const,
      status: 'UNVERIFIED' as const,
    }));

    const res = await req.db.coupon.createMany({
      data: toInsert,
      skipDuplicates: true,
    });

    await app.events.publish(req.tenantId, { type: 'coupons.updated' });
    return { created: res.count, skipped: toInsert.length - res.count };
  });

  app.post('/coupons/sync', async (req) => {
    const [aliConn, awinConn] = await Promise.all([
      req.db.marketplaceConnection.findFirst({ where: { kind: 'ALIEXPRESS' } }),
      req.db.marketplaceConnection.findFirst({ where: { kind: 'AWIN' } }),
    ]);

    const aliCreds = aliConn?.encryptedCredentials
      ? decryptJson<AliexpressCredentials>(Buffer.from(aliConn.encryptedCredentials))
      : null;
    const awinCreds = awinConn?.encryptedCredentials
      ? decryptJson<AwinCredentials>(Buffer.from(awinConn.encryptedCredentials))
      : null;

    const hasAli = Boolean(aliCreds?.appKey && aliCreds?.appSecret && aliCreds?.trackingId);
    const hasAwin = Boolean(awinCreds?.publisherId && awinCreds?.offersApiToken);

    if (!hasAli && !hasAwin) {
      throw new ApiError(
        'MARKETPLACE_ERROR',
        'Nenhuma fonte automática configurada (AliExpress ou Awin com token de ofertas)',
        400,
      );
    }

    const q = getQueue<CouponSyncJob>(QUEUE_COUPON_SYNC);
    const job = await q.add(
      'coupon-sync',
      { tenantId: req.tenantId, trigger: 'manual' },
      {
        jobId: `coupon-sync-${req.tenantId}-${Date.now()}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );

    try {
      const results = (await job.waitUntilFinished(getQueueEvents(QUEUE_COUPON_SYNC), 45_000)) as any[];
      return { queued: false, results };
    } catch {
      return { queued: true };
    }
  });

  app.post('/coupons/:id/verify', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = couponVerifySchema.parse(req.body);
    const coupon = await req.db.coupon.findFirst({ where: { id } });
    if (!coupon) throw ApiError.notFound('Cupom não encontrado');

    const now = new Date();
    await req.db.$transaction([
      req.db.couponCheck.create({
        data: {
          tenantId: req.tenantId,
          couponId: id,
          result: body.result,
          method: 'MANUAL',
          note: body.note ?? null,
          createdAt: now,
        },
      }),
      req.db.coupon.updateMany({
        where: { id },
        data: {
          status: body.result,
          lastVerifiedAt: now,
        },
      }),
    ]);

    await app.events.publish(req.tenantId, { type: 'coupons.updated' });
    const updated = await req.db.coupon.findFirst({ where: { id } });
    return toApiCoupon(updated!);
  });

  app.get('/coupons/:id/checks', async (req) => {
    const { id } = idParam.parse(req.params);
    const coupon = await req.db.coupon.findFirst({ where: { id } });
    if (!coupon) throw ApiError.notFound('Cupom não encontrado');

    const checks = await req.db.couponCheck.findMany({
      where: { couponId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { checks: checks.map(toApiCouponCheck) };
  });
}
