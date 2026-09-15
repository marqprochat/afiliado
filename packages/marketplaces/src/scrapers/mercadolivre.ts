import * as cheerio from 'cheerio';
import type { ProductData } from '@afilados/shared';
import { fetchHtml, parseMoney } from './fetcher';

export function parseMercadoLivreHtml(html: string, originalUrl: string): ProductData {
  const $ = cheerio.load(html);

  // 1. Título
  const title =
    $('h1.ui-pdp-title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    'Produto Mercado Livre';

  // 2. Preço atual e Preço original
  // Procura no container principal de preço da UI do PDP
  let currentPrice: number | undefined;
  let originalPrice: number | undefined;

  // JSON-LD fallback inicial
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? '{}');
      if (data['@type'] === 'Product' || data.offers) {
        const offers = data.offers;
        if (offers && typeof offers === 'object') {
          if (offers.price) currentPrice = Number(offers.price);
          if (offers.lowPrice) currentPrice = Number(offers.lowPrice);
          if (offers.highPrice) originalPrice = Number(offers.highPrice);
        }
      }
    } catch {}
  });

  // Preço atual via DOM (mais atualizado)
  const currentFraction = $(
    '.ui-pdp-price__second-line .andes-money-amount__fraction, .ui-pdp-price--size-large .andes-money-amount__fraction',
  )
    .first()
    .text()
    .trim();
  const currentCents = $(
    '.ui-pdp-price__second-line .andes-money-amount__cents, .ui-pdp-price--size-large .andes-money-amount__cents',
  )
    .first()
    .text()
    .trim();
  if (currentFraction) {
    const raw = currentCents ? `${currentFraction}.${currentCents}` : currentFraction;
    const parsed = parseMoney(raw);
    if (parsed !== undefined) currentPrice = parsed;
  }

  // Preço original via DOM
  const originalFraction = $(
    '.ui-pdp-price__original-value .andes-money-amount__fraction, s .andes-money-amount__fraction',
  )
    .first()
    .text()
    .trim();
  const originalCents = $(
    '.ui-pdp-price__original-value .andes-money-amount__cents, s .andes-money-amount__cents',
  )
    .first()
    .text()
    .trim();
  if (originalFraction) {
    const raw = originalCents ? `${originalFraction}.${originalCents}` : originalFraction;
    const parsed = parseMoney(raw);
    if (parsed !== undefined) originalPrice = parsed;
  }

  // Se o preço original for menor ou igual ao atual, descarta
  if (originalPrice !== undefined && currentPrice !== undefined && originalPrice <= currentPrice) {
    originalPrice = undefined;
  }

  // 3. Desconto %
  let discountPct: number | undefined;
  const discountText = $('.ui-pdp-price__second-line .ui-pdp-price__discount, .ui-pdp-discount')
    .first()
    .text()
    .trim();
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
  $('img.ui-pdp-image, .ui-pdp-gallery__figure img').each((_, el) => {
    const src = $(el).attr('data-zoom') || $(el).attr('src');
    if (src && src.startsWith('http') && !images.includes(src)) {
      images.push(src);
    }
  });
  if (images.length === 0) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.startsWith('http')) {
      images.push(ogImage);
    }
  }

  // 5. Frete e Selo Full
  let shipping: 'NONE' | 'FREE' | 'FULL' | 'UNKNOWN' = 'UNKNOWN';
  const pageText = $('body').text();
  const hasFull =
    $('svg.ui-pdp-icon--full, [class*="ui-pdp-icon--full"], .ui-pdp-color--GREEN').length > 0 ||
    /⚡\s*FULL|chegará amanhã com full|enviado pelo full/i.test(pageText);

  const hasFreeShipping =
    /frete grátis|envio grátis/i.test($('.ui-pdp-media__title, .ui-pdp-color--GREEN').text()) ||
    /frete grátis/i.test(pageText);

  if (hasFull) {
    shipping = 'FULL';
  } else if (hasFreeShipping) {
    shipping = 'FREE';
  }

  // 6. Cupons
  let couponCode: string | undefined;
  const couponMatch = pageText.match(/cupom[:\s]+([A-Z0-9_\-]{4,20})/i);
  if (couponMatch?.[1]) {
    couponCode = couponMatch[1].toUpperCase();
  }

  // 7. External ID
  const mlbMatch = originalUrl.match(/(MLB-?\d+)/i) || originalUrl.match(/\/p\/([A-Z0-9]+)/i);
  const externalId = mlbMatch ? mlbMatch[1]!.replace('-', '').toUpperCase() : undefined;

  return {
    source: 'MERCADOLIVRE',
    ...(externalId ? { externalId } : {}),
    title,
    price: currentPrice ?? 0,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discountPct !== undefined ? { discountPct } : {}),
    images,
    shipping,
    ...(couponCode ? { couponCode } : {}),
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

export async function scrapeMercadoLivre(url: string): Promise<ProductData> {
  const html = await fetchHtml(url);
  return parseMercadoLivreHtml(html, url);
}
