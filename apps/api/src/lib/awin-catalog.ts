import type { TenantClient } from '@afilados/db';
import { mapAwinCatalogRowToProductData, type ProductData } from '@afilados/shared';

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
): Promise<ProductData[]> {
  const rows = await db.awinCatalogProduct.findMany({
    where: { title: { contains: keyword, mode: 'insensitive' } },
    take: limit,
  });
  return rows.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}

export async function fetchAwinCatalogByUrls(db: TenantClient, urls: string[]): Promise<ProductData[]> {
  if (urls.length === 0) return [];
  const rows = await db.awinCatalogProduct.findMany({ where: { deepLink: { in: urls } } });
  return rows.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}
