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
  raw: AwinFeedRow;
}

export function mapAwinRow(
  row: AwinFeedRow,
  feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName'>,
): AwinCatalogUpsertInput | null {
  const externalId = row.aw_product_id;
  const deepLink = row.aw_deep_link;
  const title = row.product_name;
  const price = Number(row.search_price);
  if (!externalId || !deepLink || !title || !Number.isFinite(price)) return null;

  const originalPriceNum = row.rrp_price ? Number(row.rrp_price) : NaN;
  const originalPrice =
    Number.isFinite(originalPriceNum) && originalPriceNum > price ? originalPriceNum : null;

  return {
    feedId: feed.feedId,
    advertiserId: feed.advertiserId || null,
    advertiserName: feed.advertiserName || null,
    externalId,
    title,
    price,
    originalPrice,
    imageUrl: row.merchant_image_url || null,
    deepLink,
    raw: row,
  };
}
