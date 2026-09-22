import type { AwinFeedListEntry, AwinFeedRow } from './datafeed';

export interface AwinCatalogUpsertInput {
  feedId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  externalId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  deepLink: string;
  raw: { format: string; brand: string | null; category: string | null };
}

/**
 * Extrai o primeiro número de uma string de preço da Awin, que pode vir com sufixo de moeda
 * (`"129.90 BRL"`) e separador de milhar (`"1,299.00"` → 1299). Retorna null se não houver
 * número finito.
 */
export function parseAwinPrice(v?: string): number | null {
  if (!v) return null;
  const match = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function mapAwinRow(
  row: AwinFeedRow,
  feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName' | 'format'>,
): AwinCatalogUpsertInput | null {
  if (feed.format === 'Google') return mapGoogleRow(row, feed);
  return mapAwinFormatRow(row, feed);
}

function mapGoogleRow(
  row: AwinFeedRow,
  feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName' | 'format'>,
): AwinCatalogUpsertInput | null {
  if (row.availability === 'out_of_stock') return null;

  const externalId = row.id;
  const title = row.title;
  const deepLink = row.aw_deep_link;
  if (!externalId || !title || !deepLink) return null;

  const basePrice = parseAwinPrice(row.price);
  const salePrice = parseAwinPrice(row.sale_price);

  let price: number | null;
  let originalPrice: number | null;
  if (salePrice !== null && basePrice !== null && salePrice < basePrice) {
    price = salePrice;
    originalPrice = basePrice;
  } else {
    price = basePrice;
    originalPrice = null;
  }
  if (price === null) return null;

  return {
    feedId: feed.feedId,
    advertiserId: feed.advertiserId || null,
    advertiserName: feed.advertiserName || null,
    externalId,
    title,
    price,
    originalPrice,
    imageUrl: row.image_link || null,
    deepLink,
    raw: { format: 'Google', brand: row.brand || null, category: row.google_product_category || null },
  };
}

function mapAwinFormatRow(
  row: AwinFeedRow,
  feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName' | 'format'>,
): AwinCatalogUpsertInput | null {
  if (row.in_stock === '0' || row.is_for_sale === '0') return null;

  const externalId = row.aw_product_id;
  const title = row.product_name;
  const deepLink = row.aw_deep_link;
  if (!externalId || !title || !deepLink) return null;

  const price = parseAwinPrice(row.search_price);
  if (price === null) return null;

  const rrp = parseAwinPrice(row.rrp_price);
  const oldPrice = parseAwinPrice(row.product_price_old);
  const originalPrice = rrp !== null && rrp > price ? rrp : oldPrice !== null && oldPrice > price ? oldPrice : null;

  return {
    feedId: feed.feedId,
    advertiserId: feed.advertiserId || null,
    advertiserName: feed.advertiserName || null,
    externalId,
    title,
    price,
    originalPrice,
    imageUrl: row.merchant_image_url || row.aw_image_url || null,
    deepLink,
    raw: { format: 'Awin', brand: row.brand_name || null, category: row.category_name || null },
  };
}
