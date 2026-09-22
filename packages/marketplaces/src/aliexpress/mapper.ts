import type { ProductData } from '@afilados/shared';

export interface AliexpressRawProduct {
  product_id: string | number;
  product_title?: string;
  target_sale_price?: string | number;
  sale_price?: string | number;
  target_original_price?: string | number;
  original_price?: string | number;
  discount?: string | number;
  product_main_image_url?: string;
  product_small_image_urls?: { string?: string[] } | string[];
  promotion_link?: string;
  product_detail_url?: string;
  lastest_volume?: number;
  commission_rate?: string | number;
  shop_id?: string | number;
  shop_title?: string;
  shop_name?: string;
  [key: string]: unknown;
}

export function mapAliexpressProduct(raw: AliexpressRawProduct): ProductData {
  const externalId = String(raw.product_id);
  const title = raw.product_title || '';

  // Preço atual
  const priceRaw = raw.target_sale_price ?? raw.sale_price ?? '0';
  const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) || 0;

  // Preço original
  const origRaw = raw.target_original_price ?? raw.original_price;
  const originalPrice = origRaw != null
    ? typeof origRaw === 'number'
      ? origRaw
      : parseFloat(String(origRaw).replace(/[^0-9.]/g, '')) || undefined
    : undefined;

  // Desconto em porcentagem
  let discountPct: number | undefined;
  if (raw.discount != null) {
    const parsed = parseInt(String(raw.discount).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      discountPct = parsed;
    }
  }
  if (discountPct === undefined && originalPrice && originalPrice > price) {
    discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  // Imagens
  const images: string[] = [];
  if (raw.product_main_image_url) {
    images.push(raw.product_main_image_url);
  }
  if (raw.product_small_image_urls) {
    if (Array.isArray(raw.product_small_image_urls)) {
      images.push(...raw.product_small_image_urls);
    } else if (Array.isArray(raw.product_small_image_urls.string)) {
      images.push(...raw.product_small_image_urls.string);
    }
  }

  // URL original / fallback
  const originalUrl = raw.promotion_link || raw.product_detail_url || `https://pt.aliexpress.com/item/${externalId}.html`;

  // Comissão em %
  let commissionPct: number | undefined;
  if (raw.commission_rate != null) {
    const comm = parseFloat(String(raw.commission_rate).replace(/[^0-9.]/g, ''));
    if (!isNaN(comm)) {
      commissionPct = comm;
    }
  }

  return {
    source: 'ALIEXPRESS',
    externalId,
    title,
    price,
    ...(originalPrice && originalPrice > price ? { originalPrice } : {}),
    ...(discountPct ? { discountPct } : {}),
    images: Array.from(new Set(images.filter(Boolean))),
    shipping: 'NONE',
    originalUrl,
    ...(raw.lastest_volume != null ? { salesCount: raw.lastest_volume } : {}),
    ...(commissionPct != null ? { commissionPct } : {}),
    ...(raw.shop_id != null ? { shopId: String(raw.shop_id) } : {}),
    ...(raw.shop_title || raw.shop_name ? { shopName: String(raw.shop_title || raw.shop_name) } : {}),
    raw: raw as unknown as object,
  };
}
