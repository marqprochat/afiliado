import { forTenant, getParentTenantId, type TenantClient } from '@afilados/db';
import { runWithBudget } from '@afilados/marketplaces';
import { mapAwinCatalogRowToProductData, type ProductData } from '@afilados/shared';
import { resolveAwinImage, type ResolveAwinImage } from './awin-images';

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
      const res = await resolveImage({ imageUrl: r.imageUrl, deepLink: r.deepLink });
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
}) {
  return {
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

export async function listAwinCatalogStores(db: TenantClient): Promise<string[]> {
  const ownerTenantId = (await getParentTenantId(db.$tenantId)) ?? db.$tenantId;
  const rows = await forTenant(ownerTenantId).awinCatalogProduct.findMany({
    distinct: ['advertiserName'],
    where: { advertiserName: { not: null } },
    select: { advertiserName: true },
    orderBy: { advertiserName: 'asc' },
    take: 200,
  });
  return rows.map((r) => r.advertiserName).filter((n): n is string => Boolean(n?.trim()));
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
