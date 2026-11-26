import { forTenant, getParentTenantId, type TenantClient } from '@afilados/db';
import { compareProgrammeStats, runWithBudget } from '@afilados/marketplaces';
import {
  mapAwinCatalogRowToProductData,
  type AwinStoreOption,
  type ProductData,
} from '@afilados/shared';
import { resolveAwinImage, type ResolveAwinImage } from './awin-images';
import { listAwinProgrammeStats } from './awin-programme-stats';

/** Tempo máximo que a busca espera pelas imagens substitutas; o resto fica para a próxima. */
const IMAGE_BUDGET_MS = 4_000;
const IMAGE_CONCURRENCY = 6;

export interface AwinImageOptions {
  resolveImage?: ResolveAwinImage;
  budgetMs?: number;
}

interface ImageRow {
  id: string;
  imageUrl: string | null;
  imageOriginalUrl: string | null;
  deepLink: string;
  title: string;
}

/**
 * Troca as imagens fora do ar (feed desatualizado) pela da loja e grava no catálogo. Linhas já
 * resolvidas antes (imageUrl diferente da original) não são verificadas de novo. O que não
 * terminar dentro do prazo continua em segundo plano e aparece na próxima busca.
 */
async function fixDeadImages<T extends ImageRow>(
  db: TenantClient,
  rows: T[],
  opts: AwinImageOptions,
): Promise<T[]> {
  const resolveImage = opts.resolveImage ?? resolveAwinImage;
  const pending = rows.filter(
    (r) => r.imageUrl && !(r.imageOriginalUrl && r.imageOriginalUrl !== r.imageUrl),
  );
  if (pending.length === 0) return rows;
  const fixed = await runWithBudget(
    pending,
    async (r) => {
      const res = await resolveImage({
        imageUrl: r.imageUrl,
        deepLink: r.deepLink,
        title: r.title,
      });
      if (res.status !== 'resolved' || !res.url || res.url === r.imageUrl) return undefined;
      await db.awinCatalogProduct.updateMany({
        where: { id: r.id, imageUrl: r.imageUrl },
        data: { imageUrl: res.url, imageOriginalUrl: r.imageOriginalUrl ?? r.imageUrl },
      });
      return res.url;
    },
    { concurrency: IMAGE_CONCURRENCY, budgetMs: opts.budgetMs ?? IMAGE_BUDGET_MS },
  );
  const byId = new Map(pending.map((r, i) => [r.id, fixed[i]]));
  return rows.map((r) => {
    const url = byId.get(r.id);
    return url ? { ...r, imageUrl: url } : r;
  });
}

function toRow(r: {
  feedId: string;
  externalId: string;
  title: string;
  price: unknown;
  originalPrice: unknown;
  imageUrl: string | null;
  deepLink: string;
  raw: unknown;
  advertiserName?: string | null;
}) {
  return {
    advertiserName: r.advertiserName ?? null,
    feedId: r.feedId,
    externalId: r.externalId,
    title: r.title,
    price: Number(r.price),
    originalPrice: r.originalPrice !== null ? Number(r.originalPrice) : null,
    imageUrl: r.imageUrl,
    deepLink: r.deepLink,
    raw: r.raw,
  };
}

export async function searchAwinCatalog(
  db: TenantClient,
  keyword: string,
  limit: number,
  advertiserName?: string,
  imageOpts: AwinImageOptions = {},
): Promise<ProductData[]> {
  const ownerTenantId = (await getParentTenantId(db.$tenantId)) ?? db.$tenantId;
  const ownerDb = forTenant(ownerTenantId);
  const rows = await ownerDb.awinCatalogProduct.findMany({
    where: {
      title: { contains: keyword, mode: 'insensitive' },
      ...(advertiserName
        ? { advertiserName: { contains: advertiserName, mode: 'insensitive' } }
        : {}),
    },
    take: limit,
  });
  const withImages = await fixDeadImages(ownerDb, rows, imageOpts);
  return withImages.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}

const normalizeStoreName = (v: string) =>
  v.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/**
 * Lojas do catálogo Awin para o seletor da busca, ordenadas pelo score do programa (EPC); as que
 * ainda não têm indicadores vão para o fim, em ordem alfabética. O indicador é associado pelo
 * advertiserId e, sem ele, pelo nome da loja.
 */
export async function listAwinCatalogStores(db: TenantClient): Promise<AwinStoreOption[]> {
  const ownerTenantId = (await getParentTenantId(db.$tenantId)) ?? db.$tenantId;
  const owner = forTenant(ownerTenantId);
  const [rows, stats] = await Promise.all([
    owner.awinCatalogProduct.findMany({
      distinct: ['advertiserName'],
      where: { advertiserName: { not: null } },
      select: { advertiserName: true, advertiserId: true },
      orderBy: { advertiserName: 'asc' },
      take: 200,
    }),
    listAwinProgrammeStats(ownerTenantId),
  ]);
  const byId = new Map(stats.map((s) => [s.advertiserId, s]));
  const byName = new Map(stats.map((s) => [normalizeStoreName(s.name), s]));
  const entries = rows
    .filter((r): r is { advertiserName: string; advertiserId: string | null } =>
      Boolean(r.advertiserName?.trim()),
    )
    .map((r) => {
      const stat =
        (r.advertiserId ? byId.get(r.advertiserId) : undefined) ??
        byName.get(normalizeStoreName(r.advertiserName)) ??
        null;
      return {
        name: r.advertiserName,
        advertiserId: r.advertiserId ?? stat?.advertiserId ?? null,
        stat,
      };
    });
  entries.sort((a, b) => {
    if (a.stat && b.stat)
      return compareProgrammeStats(a.stat, b.stat) || a.name.localeCompare(b.name, 'pt-BR');
    if (a.stat) return -1;
    if (b.stat) return 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
  return entries.map(({ name, advertiserId, stat }) => ({
    name,
    advertiserId,
    epc: stat?.epc ?? null,
    currency: stat?.currency ?? null,
    score: stat?.score ?? null,
  }));
}

export async function fetchAwinCatalogByUrls(
  db: TenantClient,
  urls: string[],
): Promise<ProductData[]> {
  if (urls.length === 0) return [];
  const ownerTenantId = (await getParentTenantId(db.$tenantId)) ?? db.$tenantId;
  const rows = await forTenant(ownerTenantId).awinCatalogProduct.findMany({
    where: { deepLink: { in: urls } },
  });
  return rows.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}
