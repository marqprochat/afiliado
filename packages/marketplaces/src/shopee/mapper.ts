import { productDataSchema, type ProductData } from '@afilados/shared';

export interface ShopeeProductOfferNode {
  itemId: number;
  shopId: number;
  productName: string;
  priceMin: string;
  priceMax: string;
  priceDiscountRate: number;
  sales: number;
  commissionRate: string;
  imageUrl: string;
  shopName: string;
  shopType: number[];
  productLink: string;
  offerLink: string;
  periodStartTime: number;
  periodEndTime: number;
}

export function mapProductOffer(n: ShopeeProductOfferNode): ProductData {
  const price = Number(n.priceMin);
  const discount = n.priceDiscountRate > 0 ? n.priceDiscountRate : undefined;
  const originalPrice = discount ? Number((price / (1 - discount / 100)).toFixed(2)) : undefined;
  const commissionPct = Number((Number(n.commissionRate) * 100).toFixed(2));
  const flashSaleEndsAt = n.periodEndTime > 0 ? new Date(n.periodEndTime * 1000).toISOString() : undefined;
  const data: Record<string, unknown> = {
    source: 'SHOPEE',
    externalId: String(n.itemId),
    shopId: String(n.shopId),
    shopName: n.shopName,
    title: n.productName,
    price,
    commissionPct,
    salesCount: n.sales,
    images: n.imageUrl ? [n.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: n.productLink,
    raw: n,
  };
  if (discount !== undefined) data.discountPct = discount;
  if (originalPrice !== undefined) data.originalPrice = originalPrice;
  if (flashSaleEndsAt !== undefined) data.flashSaleEndsAt = flashSaleEndsAt;
  return productDataSchema.parse(data);
}
