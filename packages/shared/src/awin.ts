import type { ProductData } from './product';

export interface AwinCatalogRow {
  externalId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  deepLink: string;
  raw: unknown;
}

export function mapAwinCatalogRowToProductData(row: AwinCatalogRow): ProductData {
  return {
    source: 'AWIN',
    externalId: row.externalId,
    title: row.title,
    price: row.price,
    ...(row.originalPrice !== null ? { originalPrice: row.originalPrice } : {}),
    images: row.imageUrl ? [row.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: row.deepLink,
    raw: row.raw,
  };
}
