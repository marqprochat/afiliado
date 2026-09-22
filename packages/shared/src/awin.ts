import type { ProductData } from './product';

export interface AwinCatalogRow {
  feedId: string;
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
    // aw_product_id só é único dentro do feed de um anunciante — namespaceamos por feedId para
    // não colidir com o mesmo externalId vindo de outro anunciante/feed.
    externalId: `${row.feedId}:${row.externalId}`,
    title: row.title,
    price: row.price,
    ...(row.originalPrice !== null ? { originalPrice: row.originalPrice } : {}),
    images: row.imageUrl ? [row.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: row.deepLink,
    raw: row.raw,
  };
}
