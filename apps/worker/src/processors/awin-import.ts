import type { Job } from 'bullmq';
import pino from 'pino';
import { getRedis } from '../lib/redis';
import {
  prisma,
  decryptJson,
  resolveConnection,
  isTenantActive,
  getParentTenantId,
} from '@afilados/db';
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

export interface AwinImportProgress {
  phase: 'listing' | 'downloading' | 'importing' | 'completed' | 'cancelling' | 'cancelled';
  feedId?: string;
  feedName?: string;
  feedIndex?: number;
  totalFeeds?: number;
  processedRows?: number;
  estimatedRows?: number | null;
  percent?: number;
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
  progress?: (value: AwinImportProgress) => Promise<void>,
  feedIndex = 1,
  totalFeeds = 1,
  signal?: AbortSignal,
): Promise<AwinImportFeedResult> {
  const runStartedAt = new Date();
  try {
    await progress?.({
      phase: 'downloading',
      feedId,
      feedName: entry.advertiserName,
      feedIndex,
      totalFeeds,
      processedRows: 0,
      estimatedRows: entry.productCount,
    });
    const rows = await downloadFeed(entry.url, signal ? { signal } : {});
    let imported = 0;
    let batch = new Map<string, AwinCatalogUpsertInput>();
    let processedRows = 0;
    await progress?.({
      phase: 'importing',
      feedId,
      feedName: entry.advertiserName,
      feedIndex,
      totalFeeds,
      processedRows,
      estimatedRows: entry.productCount,
    });

    for await (const row of rows) {
      if (signal?.aborted) throw new Error('AWIN_IMPORT_CANCELLED');
      processedRows += 1;
      const input = mapAwinRow(row, entry);
      if (!input) continue;
      // Dedupe within the batch by externalId — last one wins.
      batch.set(input.externalId, input);
      if (batch.size >= BATCH_SIZE) {
        const values = [...batch.values()];
        await flushBatch(tenantId, feedId, values, runStartedAt);
        imported += values.length;
        batch = new Map();
        const ratio = entry.productCount ? Math.min(processedRows / entry.productCount, 1) : 0;
        const percent = Math.min(99, Math.round(((feedIndex - 1 + ratio) / totalFeeds) * 100));
        await progress?.({
          phase: 'importing',
          feedId,
          feedName: entry.advertiserName,
          feedIndex,
          totalFeeds,
          processedRows,
          estimatedRows: entry.productCount,
          percent,
        });
      }
    }
    if (batch.size > 0) {
      const values = [...batch.values()];
      await flushBatch(tenantId, feedId, values, runStartedAt);
      imported += values.length;
    }
    if (signal?.aborted) throw new Error('AWIN_IMPORT_CANCELLED');
    const ratio = entry.productCount ? Math.min(processedRows / entry.productCount, 1) : 1;
    await progress?.({
      phase: 'importing',
      feedId,
      feedName: entry.advertiserName,
      feedIndex,
      totalFeeds,
      processedRows,
      estimatedRows: entry.productCount,
      percent: Math.min(99, Math.round(((feedIndex - 1 + ratio) / totalFeeds) * 100)),
    });

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
    if (signal?.aborted) throw new Error('AWIN_IMPORT_CANCELLED');
    const error = e instanceof Error ? e.message : String(e);
    log.warn({ tenantId, feedId, error }, 'falha ao importar feed da Awin');
    return { feedId, ok: false, imported: 0, removed: 0, error };
  }
}

export async function importAwinCatalog(
  deps: AwinImportDeps,
  tenantId: string,
  progress?: (value: AwinImportProgress) => Promise<void>,
  signal?: AbortSignal,
): Promise<AwinImportFeedResult[]> {
  const listDatafeeds = deps.listDatafeeds ?? listDatafeedsReal;
  const downloadFeed = deps.downloadFeed ?? downloadFeedReal;

  // Job já enfileirado quando a conta foi desativada: não importa nada.
  if (!(await isTenantActive(tenantId))) {
    log.warn({ tenantId }, 'tenant inativo — importação Awin ignorada');
    return [];
  }

  const { row: conn } = await resolveConnection(tenantId, 'AWIN');
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
  if (!creds.feedListUrl || !creds.feedIds?.length) return [];

  await progress?.({ phase: 'listing' });
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

  for (const [index, feedId] of creds.feedIds.entries()) {
    if (signal?.aborted) throw new Error('AWIN_IMPORT_CANCELLED');
    const entry = activeById.get(feedId);
    if (!entry) {
      results.push({
        feedId,
        ok: false,
        imported: 0,
        removed: 0,
        error: 'Feed ID não encontrado na Awin',
      });
      continue;
    }
    results.push(
      await importFeed(
        tenantId,
        feedId,
        entry,
        downloadFeed,
        progress,
        index + 1,
        creds.feedIds.length,
        signal,
      ),
    );
  }
  return results;
}

export function createAwinImportProcessor(deps: AwinImportDeps = {}) {
  return async (job: Job<AwinImportJob>) => {
    if (await getParentTenantId(job.data.tenantId)) {
      await job.updateProgress({ phase: 'cancelled' });
      log.info({ tenantId: job.data.tenantId, jobId: job.id }, 'ignored obsolete affiliate import');
      return [];
    }
    const cancelKey = `awin-import:cancel:${job.id}`;
    const controller = new AbortController();
    const cancelCheck = setInterval(() => {
      void getRedis()
        .get(cancelKey)
        .then((requested) => {
          if (requested) controller.abort();
        })
        .catch((err) => log.warn({ err, jobId: job.id }, 'Awin cancellation check failed'));
    }, 500);
    cancelCheck.unref();
    log.info(
      { tenantId: job.data.tenantId, jobId: job.id },
      'iniciando importação do catálogo Awin',
    );
    const results = await importAwinCatalog(
      deps,
      job.data.tenantId,
      async (progress) => {
        if (await getRedis().get(cancelKey)) {
          controller.abort();
          throw new Error('AWIN_IMPORT_CANCELLED');
        }
        await job.updateProgress(progress);
      },
      controller.signal,
    ).catch(async (err: unknown) => {
      clearInterval(cancelCheck);
      if (!controller.signal.aborted) throw err;
      await job.updateProgress({ phase: 'cancelled' });
      log.warn({ tenantId: job.data.tenantId, jobId: job.id }, 'Awin import cancelled');
      await getRedis().del(cancelKey);
      return [];
    });
    clearInterval(cancelCheck);
    if (controller.signal.aborted) return results;
    await getRedis().del(cancelKey);
    await job.updateProgress({ phase: 'completed', percent: 100 });
    log.info(
      {
        tenantId: job.data.tenantId,
        jobId: job.id,
        feedCount: results.length,
        imported: results.reduce((sum, feed) => sum + feed.imported, 0),
        failedCount: results.filter((feed) => !feed.ok).length,
      },
      'importação do catálogo Awin concluída',
    );
    return results;
  };
}
