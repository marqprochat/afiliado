import * as cheerio from 'cheerio';
import type { ProductData } from '@afilados/shared';
import { parseProductUrl } from '@afilados/core';
import { fetchHtml, parseMoney } from './fetcher';

export function parseAliexpressHtml(html: string, originalUrl: string): ProductData {
  const $ = cheerio.load(html);

  // 1. Título
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="twitter:title"]').attr('content')?.trim() ||
    $('title').text().replace(/- AliExpress.*$/i, '').trim() ||
    'Produto AliExpress';

  // 2. Imagens
  const images: string[] = [];
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
  if (ogImage && ogImage.startsWith('http')) {
    images.push(ogImage);
  }
  const twImage = $('meta[name="twitter:image"]').attr('content')?.trim();
  if (twImage && twImage.startsWith('http') && !images.includes(twImage)) {
    images.push(twImage);
  }
  const linkImg = $('link[rel="image_src"]').attr('href')?.trim();
  if (linkImg && linkImg.startsWith('http') && !images.includes(linkImg)) {
    images.push(linkImg);
  }

  // Busca no script por imagePathList (lista completa de fotos em alta resolução do AliExpress)
  const scriptMatch = html.match(/"imagePathList"\s*:\s*(\[[^\]]+\])/);
  if (scriptMatch?.[1]) {
    try {
      const list = JSON.parse(scriptMatch[1]);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string' && item.startsWith('http') && !images.includes(item)) {
            images.push(item);
          }
        }
      }
    } catch {}
  }

  // 3. Preço atual e original (fallback da página)
  let currentPrice: number | undefined;
  let originalPrice: number | undefined;

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

  const parsedUrl = parseProductUrl(originalUrl);
  const externalId = parsedUrl.source === 'ALIEXPRESS' ? parsedUrl.externalId : undefined;

  return {
    source: 'ALIEXPRESS',
    ...(externalId ? { externalId } : {}),
    title,
    price: currentPrice ?? 0,
    ...(originalPrice && currentPrice && originalPrice > currentPrice ? { originalPrice } : {}),
    images,
    shipping: 'NONE',
    originalUrl,
    raw: { source: 'aliexpress-scrape', url: originalUrl },
  };
}

export async function scrapeAliexpress(url: string): Promise<ProductData> {
  const html = await fetchHtml(url);
  return parseAliexpressHtml(html, url);
}
