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

  // Helper Cheerio para extrair preço de um container de preço
  function parseAndesMoneyCheerio(el: ReturnType<typeof $>): number | undefined {
    if (!el || el.length === 0) return undefined;
    const frac = el.find('.andes-money-amount__fraction').first().text().replace(/\./g, '').trim();
    if (!frac) return undefined;
    const cents = el.find('.andes-money-amount__cents').first().text().trim();
    return parseMoney(cents ? `${frac}.${cents}` : frac);
  }

  // Preço original via DOM (riscado / "de")
  const originalEl = $(
    '.ui-pdp-price__original-value, .andes-money-amount--previous, s .andes-money-amount, del .andes-money-amount, s, del',
  ).first();
  const parsedOrig = parseAndesMoneyCheerio(originalEl);
  if (parsedOrig !== undefined) {
    originalPrice = parsedOrig;
  }

  // Preço atual via DOM (linha de preço atual, ignorando originais riscados)
  let currentEl = $('.ui-pdp-price__second-line').first();
  if (currentEl.length === 0 || !currentEl.find('.andes-money-amount__fraction').length) {
    currentEl = $(
      '.ui-pdp-price__price .andes-money-amount:not(.andes-money-amount--previous), .ui-pdp-price--size-large .andes-money-amount:not(.andes-money-amount--previous), .ui-pdp-price__main-container .andes-money-amount:not(.andes-money-amount--previous)',
    ).first();
  }
  const parsedCurrent = parseAndesMoneyCheerio(currentEl);
  if (parsedCurrent !== undefined) {
    currentPrice = parsedCurrent;
  } else {
    // Fallback meta tags de preço
    const metaPrice = $('meta[itemprop="price"], meta[property="product:price:amount"]').first().attr('content');
    if (metaPrice) {
      const parsed = Number(metaPrice);
      if (!isNaN(parsed) && parsed > 0) currentPrice = parsed;
    }
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
  // A galeria do ML repete a mesma foto em dois elementos: a miniatura da tira lateral
  // (`src` em baixa resolução) e a imagem grande em exibição (`data-zoom`, alta resolução).
  // Priorizamos exclusivamente `data-zoom` quando existir pelo menos um, senão a miniatura
  // de baixa resolução acaba virando images[0].
  const zoomImages: string[] = [];
  const srcImages: string[] = [];
  $('img.ui-pdp-image, .ui-pdp-gallery__figure img').each((_, el) => {
    const zoom = $(el).attr('data-zoom');
    if (zoom && zoom.startsWith('http')) {
      if (!zoomImages.includes(zoom)) zoomImages.push(zoom);
      return;
    }
    const src = $(el).attr('src');
    if (src && src.startsWith('http') && !srcImages.includes(src)) {
      srcImages.push(src);
    }
  });
  const images: string[] = zoomImages.length > 0 ? zoomImages : srcImages;
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

  // 7. Oferta Relâmpago / Oferta do Dia (com data de término quando disponível)
  const flashSaleEndsAt = detectFlashSaleEnd($, pageText, html);

  // 8. External ID
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
    ...(flashSaleEndsAt ? { flashSaleEndsAt } : {}),
    originalUrl,
    raw: {
      url: originalUrl,
      title,
      currentPrice,
      originalPrice,
      discountPct,
      shipping,
      flashSale: Boolean(flashSaleEndsAt),
    },
  };
}

const FLASH_SALE_RE = /oferta\s+rel[âa]mpago|oferta\s+do\s+dia|termina\s+em/i;

/**
 * Detecta Oferta Relâmpago/Oferta do Dia no PDP do ML e devolve a data de término em ISO.
 * Tenta, nesta ordem: timestamp explícito no HTML/JSON, contagem regressiva "termina em HH:MM:SS",
 * e por fim o fim do dia em São Paulo quando só há o selo (ofertas do dia expiram à meia-noite).
 */
export function detectFlashSaleEnd(
  $: cheerio.CheerioAPI,
  pageText: string,
  html: string,
  now: Date = new Date(),
): string | undefined {
  const pillText = $(
    '.ui-pdp-promotions-pill-label, .ui-pdp-price__lightning, [class*="lightning"], [class*="deal-of-the-day"]',
  ).text();
  const hasFlash = FLASH_SALE_RE.test(pillText) || FLASH_SALE_RE.test(pageText);
  if (!hasFlash) return undefined;

  // a) Timestamp explícito (atributo data-* ou JSON embutido no HTML)
  const explicit =
    html.match(/data-(?:end|expiration)-date=["']([^"']+)["']/i)?.[1] ??
    html.match(
      /"(?:end_date|endDate|end_time|expiration_date|expirationDate)"\s*:\s*"([^"]+)"/,
    )?.[1];
  if (explicit) {
    const d = new Date(explicit);
    if (!isNaN(d.getTime()) && d.getTime() > now.getTime()) return d.toISOString();
  }

  // b) Contagem regressiva textual ("Termina em 03:12:45")
  const countdown = pageText.match(/termina\s+em\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (countdown) {
    const h = Number(countdown[1]);
    const m = Number(countdown[2]);
    const sec = Number(countdown[3] ?? 0);
    return new Date(now.getTime() + ((h * 60 + m) * 60 + sec) * 1000).toISOString();
  }

  // c) Só o selo: assume fim do dia em São Paulo (UTC-3)
  const spNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const endOfDayUtc = Date.UTC(
    spNow.getUTCFullYear(),
    spNow.getUTCMonth(),
    spNow.getUTCDate(),
    23 + 3,
    59,
    59,
  );
  return new Date(endOfDayUtc).toISOString();
}

export async function scrapeMercadoLivre(url: string): Promise<ProductData> {
  const html = await fetchHtml(url);
  return parseMercadoLivreHtml(html, url);
}
