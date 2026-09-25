import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import type { CouponSyncJob } from '@afilados/shared';
import {
  fetchAliexpressPromoCodes,
  listAwinVouchers,
  type AliexpressCredentials,
  type AwinCredentials,
} from '@afilados/marketplaces';
import { upsertCoupon } from '../lib/coupon-upsert';
import { publishEvent } from '../lib/events';

const log = pino({ name: 'coupon-sync-processor' });

export interface CouponSyncResult {
  source: 'ALIEXPRESS' | 'AWIN' | 'EXPIRY';
  ok: boolean;
  created: number;
  updated: number;
  expired: number;
  error?: string;
}

export interface CouponSyncProcessorDeps {
  fetchAliexpressPromoCodes?: typeof fetchAliexpressPromoCodes;
  listAwinVouchers?: typeof listAwinVouchers;
  now?: () => Date;
}

export function createCouponSyncProcessor(deps: CouponSyncProcessorDeps = {}) {
  const fetchAli = deps.fetchAliexpressPromoCodes ?? fetchAliexpressPromoCodes;
  const listAwin = deps.listAwinVouchers ?? listAwinVouchers;
  const getNow = deps.now ?? (() => new Date());

  return async (job: Job<CouponSyncJob>): Promise<CouponSyncResult[]> => {
    const { tenantId } = job.data;
    const now = getNow();
    const runStartedAt = now;
    const results: CouponSyncResult[] = [];

    // 1. AliExpress
    const aliConn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'ALIEXPRESS' },
    });

    if (aliConn?.encryptedCredentials) {
      try {
        const aliCreds = decryptJson<AliexpressCredentials>(
          Buffer.from(aliConn.encryptedCredentials),
        );

        if (aliCreds.appKey && aliCreds.appSecret && aliCreds.trackingId) {
          // Busca keywords das regras de automação ativas
          const rules = await prisma.automationRule.findMany({
            where: { tenantId, enabled: true },
            select: { keywords: true, marketplaces: true },
          });

          const aliKeywords = new Set<string>();
          for (const r of rules) {
            if (r.marketplaces.includes('ALIEXPRESS')) {
              for (const kw of r.keywords) {
                if (kw.trim()) aliKeywords.add(kw.trim());
              }
            }
          }

          const kwList = Array.from(aliKeywords).slice(0, 5);
          const keywords = kwList.length > 0 ? kwList : ['promo', 'cupom', 'desconto', 'oferta', 'fones'];

          const aliCoupons = await fetchAli(aliCreds, { keywords });
          let created = 0;
          let updated = 0;

          for (const c of aliCoupons) {
            const res = await upsertCoupon(tenantId, c, 'API', now);
            if (res === 'created') created++;
            else updated++;
          }

          results.push({ source: 'ALIEXPRESS', ok: true, created, updated, expired: 0 });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error({ tenantId, err: errorMsg }, 'falha ao sincronizar cupons do AliExpress');
        results.push({ source: 'ALIEXPRESS', ok: false, created: 0, updated: 0, expired: 0, error: errorMsg });
      }
    }

    // 2. Awin
    const awinConn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'AWIN' },
    });

    if (awinConn?.encryptedCredentials) {
      try {
        const awinCreds = decryptJson<AwinCredentials>(
          Buffer.from(awinConn.encryptedCredentials),
        );

        if (awinCreds.publisherId && awinCreds.offersApiToken) {
          const vouchers = await listAwin(
            { publisherId: awinCreds.publisherId, offersApiToken: awinCreds.offersApiToken },
          );

          let created = 0;
          let updated = 0;

          for (const v of vouchers) {
            const res = await upsertCoupon(tenantId, v, 'API', now);
            if (res === 'created') created++;
            else updated++;
          }

          // Expira cupons da Awin ausentes nesta rodada
          const missingAwinCoupons = await prisma.coupon.findMany({
            where: {
              tenantId,
              store: 'AWIN',
              origin: 'API',
              status: { not: 'EXPIRED' },
              lastSeenAt: { lt: runStartedAt },
            },
          });

          let expired = 0;
          for (const mc of missingAwinCoupons) {
            await prisma.coupon.update({
              where: { id: mc.id },
              data: { status: 'EXPIRED' },
            });
            await prisma.couponCheck.create({
              data: {
                tenantId,
                couponId: mc.id,
                result: 'EXPIRED',
                method: 'SOURCE',
                note: 'não está mais ativo na Awin',
              },
            });
            expired++;
          }

          results.push({ source: 'AWIN', ok: true, created, updated, expired });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error({ tenantId, err: errorMsg }, 'falha ao sincronizar cupons da Awin');
        results.push({ source: 'AWIN', ok: false, created: 0, updated: 0, expired: 0, error: errorMsg });
      }
    }

    // 3. Varredura de expiração por data (global do tenant)
    const expiredByDate = await prisma.coupon.findMany({
      where: {
        tenantId,
        expiresAt: { lt: now },
        status: { not: 'EXPIRED' },
      },
    });

    let expiryCount = 0;
    for (const ec of expiredByDate) {
      await prisma.coupon.update({
        where: { id: ec.id },
        data: { status: 'EXPIRED' },
      });
      await prisma.couponCheck.create({
        data: {
          tenantId,
          couponId: ec.id,
          result: 'EXPIRED',
          method: 'EXPIRY',
          note: 'Expirado por data',
        },
      });
      expiryCount++;
    }

    results.push({ source: 'EXPIRY', ok: true, created: 0, updated: 0, expired: expiryCount });

    // Publica evento para atualizar UI em tempo real
    await publishEvent(tenantId, { type: 'coupons.updated' }).catch((err) => {
      log.warn({ tenantId, err }, 'falha ao publicar evento coupons.updated');
    });

    return results;
  };
}
