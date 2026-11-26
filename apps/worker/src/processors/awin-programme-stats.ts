import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson, getParentTenantId, isTenantActive } from '@afilados/db';
import type { AwinProgrammeStatsJob } from '@afilados/shared';
import {
  listAwinProgrammes,
  getAwinProgrammeDetails,
  computeProgrammeScore,
  AwinApiError,
  AWIN_LEGACY_API_INTERVAL_MS,
  type AwinCredentials,
} from '@afilados/marketplaces';
import { AWIN_TOKEN_ERROR } from './coupon-sync';

const log = pino({ name: 'awin-programme-stats' });

export interface AwinProgrammeStatsResult {
  ok: boolean;
  upserted: number;
  removed: number;
  failed: number;
  skipped?: 'tenant-inactive' | 'affiliate' | 'no-credentials';
  error?: string;
}

export interface AwinProgrammeStatsDeps {
  listAwinProgrammes?: typeof listAwinProgrammes;
  getAwinProgrammeDetails?: typeof getAwinProgrammeDetails;
  /** Pausa entre chamadas à API legada (injetável para os testes não esperarem). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  intervalMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lista os programas aprovados (joined) e busca os indicadores de cada um em `programmedetails`,
 * um por vez respeitando o limite da API legada (20/min). Grava de forma idempotente e remove os
 * programas que saíram da lista. Só para a conta dona das credenciais (afiliados compartilham o
 * mesmo publisher e leem os indicadores do dono).
 */
export function createAwinProgrammeStatsProcessor(deps: AwinProgrammeStatsDeps = {}) {
  const list = deps.listAwinProgrammes ?? listAwinProgrammes;
  const getDetails = deps.getAwinProgrammeDetails ?? getAwinProgrammeDetails;
  const sleep = deps.sleep ?? defaultSleep;
  const getNow = deps.now ?? (() => new Date());
  const intervalMs = Math.max(
    deps.intervalMs ?? AWIN_LEGACY_API_INTERVAL_MS,
    AWIN_LEGACY_API_INTERVAL_MS,
  );

  return async (job: Job<AwinProgrammeStatsJob>): Promise<AwinProgrammeStatsResult> => {
    const { tenantId } = job.data;
    const empty = { upserted: 0, removed: 0, failed: 0 };

    if (!(await isTenantActive(tenantId))) {
      return { ok: true, ...empty, skipped: 'tenant-inactive' };
    }
    if (await getParentTenantId(tenantId)) return { ok: true, ...empty, skipped: 'affiliate' };

    const conn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'AWIN' },
    });
    if (!conn?.encryptedCredentials) return { ok: true, ...empty, skipped: 'no-credentials' };
    const stored = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
    if (!stored.publisherId || !stored.offersApiToken) {
      return { ok: true, ...empty, skipped: 'no-credentials' };
    }
    const creds = { publisherId: stored.publisherId, offersApiToken: stored.offersApiToken };

    let upserted = 0;
    let failed = 0;
    try {
      const programmes = await list(creds, { relationship: 'joined' });
      const joinedIds = [...new Set(programmes.map((p) => String(p.id)).filter(Boolean))];

      for (const advertiserId of joinedIds) {
        await sleep(intervalMs);
        let details;
        try {
          details = await getDetails(creds, advertiserId);
        } catch (err) {
          if (err instanceof AwinApiError && err.code === 'AWIN_UNAUTHORIZED') throw err;
          failed++;
          log.warn({ tenantId, advertiserId, err: String(err) }, 'falha nos detalhes do programa');
          continue;
        }
        if (!details) {
          failed++;
          continue;
        }
        const score = computeProgrammeScore(details);
        const data = {
          name: details.name,
          logoUrl: details.logoUrl,
          displayUrl: details.displayUrl,
          currency: details.currency,
          epc: details.epc,
          conversionRate: details.conversionRate,
          approvalPercentage: details.approvalPercentage,
          averagePaymentTime: details.averagePaymentTime,
          validationDays: details.validationDays,
          awinIndex: details.awinIndex,
          commissionMin: details.commissionMin,
          commissionMax: details.commissionMax,
          commissionType: details.commissionType,
          score,
          fetchedAt: getNow(),
        };
        await prisma.awinProgrammeStats.upsert({
          where: { tenantId_advertiserId: { tenantId, advertiserId } },
          create: { tenantId, advertiserId, ...data },
          update: data,
        });
        upserted++;
      }

      const { count: removed } = await prisma.awinProgrammeStats.deleteMany({
        where: { tenantId, advertiserId: { notIn: joinedIds } },
      });

      if (conn.lastError === AWIN_TOKEN_ERROR) {
        await prisma.marketplaceConnection.update({
          where: { id: conn.id },
          data: { status: 'OK', lastError: null, lastCheckedAt: getNow() },
        });
      }
      log.info(
        { tenantId, upserted, removed, failed },
        'indicadores dos programas Awin atualizados',
      );
      return { ok: true, upserted, removed, failed };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ tenantId, err: error }, 'falha ao atualizar indicadores dos programas Awin');
      if (err instanceof AwinApiError && err.code === 'AWIN_UNAUTHORIZED') {
        try {
          await prisma.marketplaceConnection.update({
            where: { id: conn.id },
            data: { status: 'ERROR', lastError: AWIN_TOKEN_ERROR, lastCheckedAt: getNow() },
          });
        } catch (updateErr) {
          log.error({ tenantId, err: String(updateErr) }, 'falha ao marcar conexão Awin com erro');
        }
      }
      return { ok: false, upserted, removed: 0, failed, error };
    }
  };
}
