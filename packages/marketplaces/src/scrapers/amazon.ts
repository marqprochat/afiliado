import * as cheerio from 'cheerio';
import type { ProductData } from '@afilados/shared';
import { fetchHtml, parseMoney } from './fetcher';

export function parseAmazonHtml(html: string, originalUrl: string): ProductData {
  const $ = cheerio.load(html);

  // 1. Título
  const title =
    $('#productTitle').first().text().trim() ||
    $('#title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    'Produto Amazon';

  // 2. Preço atual e Preço original
  let currentPrice: number | undefined;
  let originalPrice: number | undefined;

  // Seletores da Amazon para preço atual:
  // .a-price .a-offscreen dentro do corePrice_feature_div ou apexPriceToPay
  const currentOffscreen = $(
    '#corePrice_feature_div .a-price .a-offscreen, #apexPriceToPay .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price.priceToPay .a-offscreen',
  )
    .first()
    .text()
    .trim();
  if (currentOffscreen) {
    currentPrice = parseMoney(currentOffscreen);
  } else {
    // Fallback para whole + fraction
    const whole = $('#corePrice_feature_div .a-price-whole').first().text().replace(/[^\d]/g, '');
    const fraction = $('#corePrice_feature_div .a-price-fraction').first().text().replace(/[^\d]/g, '');
    if (whole) {
      currentPrice = parseMoney(fraction ? `${whole}.${fraction}` : whole);
    }
  }

  // Preço original (de/basis price)
  const basisOffscreen = $(
    '#basisPrice .a-offscreen, .a-price.a-text-price .a-offscreen, #listPrice .a-offscreen',
  )
    .first()
    .text()
    .trim();
  if (basisOffscreen) {
    originalPrice = parseMoney(basisOffscreen);
  }

  if (originalPrice !== undefined && currentPrice !== undefined && originalPrice <= currentPrice) {
    originalPrice = undefined;
  }

  // 3. Desconto %
  let discountPct: number | undefined;
  const savingOverride = $('.savingPriceOverride, .reinventPriceSavingsPercentageMargin')
    .first()
    .text()
    .trim();
  if (savingOverride) {
    const match = savingOverride.match(/(\d+)\s*%/);
    if (match?.[1]) {
      discountPct = parseInt(match[1], 10);
    }
  }
  if (!discountPct && originalPrice && currentPrice && originalPrice > currentPrice) {
    discountPct = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }

  // 4. Imagens
  const images: string[] = [];
  const landingImg = $('#landingImage, #imgBlkFront').first();
  const hires = landingImg.attr('data-old-hires');
  const dynamic = landingImg.attr('data-a-dynamic-image');
  const src = landingImg.attr('src');

  if (hires && hires.startsWith('http')) {
    images.push(hires);
  } else if (dynamic) {
    try {
      const parsedDynamic = JSON.parse(dynamic);
      const keys = Object.keys(parsedDynamic);
      if (keys.length > 0 && keys[0]?.startsWith('http')) {
        images.push(keys[0]);
      }
    } catch {}
  } else if (src && src.startsWith('http')) {
    images.push(src);
  }

  if (images.length === 0) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.startsWith('http')) {
      images.push(ogImage);
    }
  }

  // 5. Frete / Prime
  let shipping: 'NONE' | 'FREE' | 'FULL' | 'UNKNOWN' = 'UNKNOWN';
  const pageText = $('body').text();
  const hasPrime =
    $('#primeSavingsUpsell, .a-icon-prime, [aria-label*="Prime"]').length > 0 ||
    /frete grátis com o prime/i.test(pageText);

  const hasFreeShipping =
    /frete grátis/i.test($('#deliveryMessageMirId, #FREE_DELIVERY').text()) ||
    /frete grátis/i.test(pageText);

  if (hasPrime) {
    shipping = 'FREE';
  } else if (hasFreeShipping) {
    shipping = 'FREE';
  }

  // 6. Cupom Amazon
  let couponCode: string | undefined;
  let couponValue: number | undefined;
  const couponText = $('#couponText, .couponBadge, [id*="coupon"]').first().text().trim();
  if (couponText) {
    const couponValMatch = couponText.match(/R\$\s*(\d+[.,]?\d*)/i);
    if (couponValMatch?.[1]) {
      couponValue = parseMoney(couponValMatch[1]);
    }
    const pctMatch = couponText.match(/(\d+)%/i);
    if (pctMatch?.[1] && currentPrice) {
      couponValue = Math.round(((currentPrice * parseInt(pctMatch[1], 10)) / 100) * 100) / 100;
    }
    couponCode = 'CUPOM AMAZON';
  }

  // 7. External ID (ASIN)
  const asinMatch =
    originalUrl.match(/\/dp\/([A-Z0-9]{10})/i) ||
    originalUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
    originalUrl.match(/\/product\/([A-Z0-9]{10})/i);
  const externalId = asinMatch ? asinMatch[1]!.toUpperCase() : undefined;

  return {
    source: 'AMAZON',
    ...(externalId ? { externalId } : {}),
    title,
    price: currentPrice ?? 0,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discountPct !== undefined ? { discountPct } : {}),
    images,
    shipping,
    ...(couponCode ? { couponCode } : {}),
    ...(couponValue !== undefined ? { couponValue } : {}),
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

export async function scrapeAmazon(url: string): Promise<ProductData> {
  const html = await fetchHtml(url);
  return parseAmazonHtml(html, url);
}
