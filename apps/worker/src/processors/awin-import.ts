import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  downloadFeed as downloadFeedReal,
  listDatafeeds as listDatafeedsReal,
  mapAwinRow,
  type AwinCredentials,
} from '@afilados/marketplaces';
import type { AwinImportJob } from '@afilados/shared';

const log = pino({ name: 'awin-import' });

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

export async function importAwinCatalog(
  deps: AwinImportDeps,
  tenantId: string,
): Promise<AwinImportFeedResult[]> {
  const listDatafeeds = deps.listDatafeeds ?? listDatafeedsReal;
  const downloadFeed = deps.downloadFeed ?? downloadFeedReal;

  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
  if (!creds.datafeedApiKey || !creds.feedIds?.length) return [];

  const feeds = await listDatafeeds(creds.datafeedApiKey);
  const byId = new Map(feeds.map((f) => [f.feedId, f]));
  const results: AwinImportFeedResult[] = [];

  for (const feedId of creds.feedIds) {
    const entry = byId.get(feedId);
    if (!entry) {
      results.push({ feedId, ok: false, imported: 0, removed: 0, error: 'Feed ID não encontrado na Awin' });
      continue;
    }
    const runStartedAt = new Date();
    try {
      const rows = await downloadFeed(entry.url);
      let imported = 0;
      for (const row of rows) {
        const input = mapAwinRow(row, entry);
        if (!input) continue;
        await prisma.awinCatalogProduct.upsert({
          where: { tenantId_feedId_externalId: { tenantId, feedId, externalId: input.externalId } },
          update: {
            title: input.title,
            price: input.price,
            originalPrice: input.originalPrice,
            imageUrl: input.imageUrl,
            deepLink: input.deepLink,
            advertiserId: input.advertiserId,
            advertiserName: input.advertiserName,
            raw: input.raw,
            lastImportedAt: runStartedAt,
          },
          create: {
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
          },
        });
        imported++;
      }
      const pruned = await prisma.awinCatalogProduct.deleteMany({
        where: { tenantId, feedId, lastImportedAt: { lt: runStartedAt } },
      });
      results.push({ feedId, ok: true, imported, removed: pruned.count });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log.warn({ tenantId, feedId, error }, 'falha ao importar feed da Awin');
      results.push({ feedId, ok: false, imported: 0, removed: 0, error });
    }
  }
  return results;
}

export function createAwinImportProcessor(deps: AwinImportDeps = {}) {
  return async (job: Job<AwinImportJob>) => {
    return importAwinCatalog(deps, job.data.tenantId);
  };
}
