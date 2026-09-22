import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  downloadFeed as downloadFeedReal,
  listDatafeeds as listDatafeedsReal,
  mapAwinRow,
  type AwinCredentials,
  type AwinCatalogUpsertInput,
  type AwinFeedListEntry,
} from '@afilados/marketplaces';
import type { AwinImportJob } from '@afilados/shared';

const log = pino({ name: 'awin-import' });

const BATCH_SIZE = 500;

export interface AwinImportDeps {
  listDatafeeds?: typeof listDatafeedsReal;
  downloadFeed?: typeof downloadFeedReal;
}

export interface AwinImportFeedResult {
  feedId: string;
  ok: boolean;
  imported: number;
  removed: number;
  error?: string;
}

async function flushBatch(
  tenantId: string,
  feedId: string,
  batch: AwinCatalogUpsertInput[],
  runStartedAt: Date,
): Promise<void> {
  if (batch.length === 0) return;
  const ids = batch.map((b) => b.externalId);
  await prisma.$transaction([
    prisma.awinCatalogProduct.deleteMany({
      where: { tenantId, feedId, externalId: { in: ids } },
    }),
    prisma.awinCatalogProduct.createMany({
      data: batch.map((input) => ({
        tenantId,
        feedId,
        externalId: input.externalId,
        title: input.title,
        price: input.price,
        originalPrice: input.originalPrice,
        imageUrl: input.imageUrl,
        deepLink: input.deepLink,
        advertiserId: input.advertiserId,
        advertiserName: input.advertiserName,
        raw: input.raw,
        lastImportedAt: runStartedAt,
      })),
    }),
  ]);
}

async function importFeed(
  tenantId: string,
  feedId: string,
  entry: AwinFeedListEntry,
  downloadFeed: typeof downloadFeedReal,
): Promise<AwinImportFeedResult> {
  const runStartedAt = new Date();
  try {
    const rows = await downloadFeed(entry.url);
    let imported = 0;
    let batch = new Map<string, AwinCatalogUpsertInput>();

    for await (const row of rows) {
      const input = mapAwinRow(row, entry);
      if (!input) continue;
      // Dedupe within the batch by externalId — last one wins.
      batch.set(input.externalId, input);
      if (batch.size >= BATCH_SIZE) {
        const values = [...batch.values()];
        await flushBatch(tenantId, feedId, values, runStartedAt);
        imported += values.length;
        batch = new Map();
      }
    }
    if (batch.size > 0) {
      const values = [...batch.values()];
      await flushBatch(tenantId, feedId, values, runStartedAt);
      imported += values.length;
    }

    if (imported === 0) {
      // Download vazio ou todas as linhas falharam mapAwinRow (coluna renomeada, arquivo
      // truncado etc.) — pular a poda evita zerar um catálogo que já existia e estava bom.
      log.warn(
        { tenantId, feedId },
        'feed retornou 0 produtos válidos — pulando poda para não zerar o catálogo',
      );
      return { feedId, ok: true, imported: 0, removed: 0 };
    }
    const pruned = await prisma.awinCatalogProduct.deleteMany({
      where: { tenantId, feedId, lastImportedAt: { lt: runStartedAt } },
    });
    return { feedId, ok: true, imported, removed: pruned.count };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn({ tenantId, feedId, error }, 'falha ao importar feed da Awin');
    return { feedId, ok: false, imported: 0, removed: 0, error };
  }
}

export async function importAwinCatalog(
  deps: AwinImportDeps,
  tenantId: string,
): Promise<AwinImportFeedResult[]> {
  const listDatafeeds = deps.listDatafeeds ?? listDatafeedsReal;
  const downloadFeed = deps.downloadFeed ?? downloadFeedReal;

  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
  if (!creds.feedListUrl || !creds.feedIds?.length) return [];

  let feeds: AwinFeedListEntry[];
  try {
    feeds = await listDatafeeds(creds.feedListUrl);
  } catch (e) {
    // Link da lista de feeds inválido/expirado — não deve derrubar o job inteiro, só reportar
    // erro por feed selecionado (mesmo comportamento de um feedId não encontrado).
    const error = e instanceof Error ? e.message : String(e);
    log.warn({ tenantId, error }, 'falha ao listar feeds da Awin');
    return creds.feedIds.map((feedId) => ({ feedId, ok: false, imported: 0, removed: 0, error }));
  }

  const activeById = new Map(
    feeds.filter((f) => f.membershipStatus === 'active').map((f) => [f.feedId, f]),
  );
  const results: AwinImportFeedResult[] = [];

  for (const feedId of creds.feedIds) {
    const entry = activeById.get(feedId);
    if (!entry) {
      results.push({ feedId, ok: false, imported: 0, removed: 0, error: 'Feed ID não encontrado na Awin' });
      continue;
    }
    results.push(await importFeed(tenantId, feedId, entry, downloadFeed));
  }
  return results;
}

export function createAwinImportProcessor(deps: AwinImportDeps = {}) {
  return async (job: Job<AwinImportJob>) => {
    return importAwinCatalog(deps, job.data.tenantId);
  };
}
