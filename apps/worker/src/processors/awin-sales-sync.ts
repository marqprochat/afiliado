import type { Job } from 'bullmq';
import pino from 'pino';
import {
  prisma,
  decryptJson,
  getParentTenantId,
  isTenantActive,
  upsertAffiliateSale,
} from '@afilados/db';
import type { AwinSalesSyncJob } from '@afilados/shared';
import {
  listAwinTransactions,
  AwinApiError,
  AWIN_TRANSACTIONS_MAX_DAYS,
  type AwinCredentials,
} from '@afilados/marketplaces';
import { AWIN_TOKEN_ERROR } from './coupon-sync';

const log = pino({ name: 'awin-sales-sync' });
const DAY_MS = 86_400_000;

export interface AwinSalesSyncResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped?: 'tenant-inactive' | 'affiliate' | 'no-credentials';
  error?: string;
}

export interface AwinSalesSyncDeps {
  listAwinTransactions?: typeof listAwinTransactions;
  now?: () => Date;
}

/**
 * Busca as transações da Awin da janela pedida (7 dias de hora em hora, 31 dias 1×/dia) e grava
 * de forma idempotente. Só para a conta dona das credenciais (afiliados herdam o mesmo publisher,
 * então sincronizar neles duplicaria as vendas).
 */
export function createAwinSalesSyncProcessor(deps: AwinSalesSyncDeps = {}) {
  const list = deps.listAwinTransactions ?? listAwinTransactions;
  const getNow = deps.now ?? (() => new Date());

  return async (job: Job<AwinSalesSyncJob>): Promise<AwinSalesSyncResult> => {
    const { tenantId } = job.data;
    const now = getNow();
    const empty = { created: 0, updated: 0 };

    if (!(await isTenantActive(tenantId))) {
      return { ok: true, ...empty, skipped: 'tenant-inactive' };
    }
    if (await getParentTenantId(tenantId)) return { ok: true, ...empty, skipped: 'affiliate' };

    const conn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'AWIN' },
    });
    if (!conn?.encryptedCredentials) return { ok: true, ...empty, skipped: 'no-credentials' };
    const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
    if (!creds.publisherId || !creds.offersApiToken) {
      return { ok: true, ...empty, skipped: 'no-credentials' };
    }

    const days = Math.min(Math.max(1, job.data.windowDays || 7), AWIN_TRANSACTIONS_MAX_DAYS);
    try {
      const transactions = await list(
        { publisherId: creds.publisherId, offersApiToken: creds.offersApiToken },
        {
          startDate: new Date(now.getTime() - days * DAY_MS),
          endDate: now,
          dateType: 'transaction',
        },
      );
      let created = 0;
      let updated = 0;
      for (const t of transactions) {
        const r = await upsertAffiliateSale(tenantId, t, 'API');
        if (r === 'created') created++;
        else updated++;
      }
      if (conn.lastError === AWIN_TOKEN_ERROR) {
        await prisma.marketplaceConnection.update({
          where: { id: conn.id },
          data: { status: 'OK', lastError: null, lastCheckedAt: now },
        });
      }
      log.info({ tenantId, days, created, updated }, 'vendas da Awin sincronizadas');
      return { ok: true, created, updated };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ tenantId, err: error }, 'falha ao sincronizar vendas da Awin');
      if (err instanceof AwinApiError && err.code === 'AWIN_UNAUTHORIZED') {
        try {
          await prisma.marketplaceConnection.update({
            where: { id: conn.id },
            data: { status: 'ERROR', lastError: AWIN_TOKEN_ERROR, lastCheckedAt: now },
          });
        } catch (updateErr) {
          log.error({ tenantId, err: String(updateErr) }, 'falha ao marcar conexão Awin com erro');
        }
      }
      return { ok: false, ...empty, error };
    }
  };
}
