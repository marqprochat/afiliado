import * as cheerio from 'cheerio';
import type { ProductData } from '@afilados/shared';
import { fetchHtml, parseMoney } from './fetcher';

export function parseMagaluHtml(html: string, originalUrl: string): ProductData {
  const $ = cheerio.load(html);

  // 1. Título
  const title =
    $('[data-testid="heading-product-title"]').first().text().trim() ||
    $('h1.header-product__title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    'Produto Magazine Luiza';

  // 2. Preço atual e Preço original
  let currentPrice: number | undefined;
  let originalPrice: number | undefined;

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? '{}');
      if (data['@type'] === 'Product' || data.offers) {
        const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
        if (offers && typeof offers === 'object') {
          if (offers.price) currentPrice = Number(offers.price);
          if (offers.lowPrice) currentPrice = Number(offers.lowPrice);
          if (offers.highPrice) originalPrice = Number(offers.highPrice);
        }
      }
    } catch {}
  });

  // Preço atual via DOM
  const currentDom = $(
    '[data-testid="price-value"], [data-testid="price-default"], .price-template__text, [data-testid="price-best"]',
  )
    .first()
    .text()
    .trim();
  if (currentDom) {
    const parsed = parseMoney(currentDom);
    if (parsed !== undefined) currentPrice = parsed;
  }

  // Preço original via DOM
  const origDom = $('[data-testid="price-original"], [data-testid="price-from"], .price-template__from')
    .first()
    .text()
    .trim();
  if (origDom) {
    const parsed = parseMoney(origDom);
    if (parsed !== undefined) originalPrice = parsed;
  }

  if (originalPrice !== undefined && currentPrice !== undefined && originalPrice <= currentPrice) {
    originalPrice = undefined;
  }

  // 3. Desconto %
  let discountPct: number | undefined;
  const discountText = $('[data-testid="price-discount"], .discount-tag').first().text().trim();
  if (discountText) {
    const match = discountText.match(/(\d+)\s*%/);
    if (match?.[1]) {
      discountPct = parseInt(match[1], 10);
    }
  }
  if (!discountPct && originalPrice && currentPrice && originalPrice > currentPrice) {
    discountPct = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  // 4. Imagens
  const images: string[] = [];
  $('[data-testid="image-selected-thumbnail"], img.image-gallery-image, [data-testid="main-image"]').each(
    (_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !images.includes(src)) {
        images.push(src);
      }
    },
  );
  if (images.length === 0) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.startsWith('http')) {
      images.push(ogImage);
    }
  }

  // 5. Frete
  let shipping: 'NONE' | 'FREE' | 'FULL' | 'UNKNOWN' = 'UNKNOWN';
  const pageText = $('body').text();
  const hasFreeShipping =
    /frete grátis/i.test($('[data-testid="shipping-free"]').text()) ||
    /frete grátis|retira rápido|retira grátis/i.test(pageText);

  if (hasFreeShipping) {
    shipping = 'FREE';
  }

  // 6. External ID (Código / SKU do produto)
  const skuMatch = originalUrl.match(/\/p\/([a-z0-9]+)/i) || originalUrl.match(/\/([a-z0-9]{7,12})\//i);
  const externalId = skuMatch ? skuMatch[1]!.toUpperCase() : undefined;

  return {
    source: 'MAGALU',
    ...(externalId ? { externalId } : {}),
    title,
    price: currentPrice ?? 0,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discountPct !== undefined ? { discountPct } : {}),
    images,
    shipping,
    originalUrl,
    raw: {
      url: originalUrl,
      title,
      currentPrice,
      originalPrice,
      discountPct,
      shipping,
    },
  };
}

export async function scrapeMagalu(url: string): Promise<ProductData> {
  const html = await fetchHtml(url);
  return parseMagaluHtml(html, url);
}
