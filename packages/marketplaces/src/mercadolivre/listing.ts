import * as cheerio from 'cheerio';
import { parseProductUrl } from '@afilados/core';
import type { ProductData } from '@afilados/shared';
import { parseMoney } from '../scrapers/fetcher';
import { endOfDaySaoPaulo } from '../scrapers/mercadolivre';

/**
 * Busca de produtos do ML pelas páginas de listagem (/ofertas, /mais-vendidos…). A busca por
 * palavra-chave (lista.mercadolivre.com.br) é bloqueada pelo anti-bot, mas essas listagens respondem
 * normalmente e já trazem título, imagem, preço atual, preço riscado e "% OFF" em cada card, sem
 * abrir a página de cada produto. Ver docs/superpowers/specs/2026-10-05-ml-ofertas-listagem-design.md.
 */

const ML_ORIGIN = 'https://www.mercadolivre.com.br';

export type MlListingSource =
  | { kind: 'deals' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'lightning' }
  | { kind: 'url'; url: string };

export type MlListingErrorCode =
  'ML_LISTING_BLOCKED' | 'ML_LISTING_LAYOUT' | 'ML_LISTING_INVALID_URL' | 'ML_LISTING_HTTP';

export class MlListingError extends Error {
  constructor(
    message: string,
    public readonly code: MlListingErrorCode,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'MlListingError';
  }
}

function isMlHost(hostname: string): boolean {
  return hostname === 'mercadolivre.com.br' || hostname.endsWith('.mercadolivre.com.br');
}

/** URL da página `page` (1-based) da fonte; lança `ML_LISTING_INVALID_URL` para entrada insegura. */
export function buildMlListingUrl(source: MlListingSource, page: number): string {
  const invalid = (msg: string) => new MlListingError(msg, 'ML_LISTING_INVALID_URL');
  let u: URL;
  switch (source.kind) {
    case 'deals':
      u = new URL(`${ML_ORIGIN}/ofertas`);
      break;
    case 'lightning':
      u = new URL(`${ML_ORIGIN}/ofertas`);
      u.searchParams.set('promotion_type', 'lightning');
      break;
    case 'category':
      if (!/^MLB\d+$/.test(source.categoryId)) throw invalid('Categoria do Mercado Livre inválida');
      u = new URL(`${ML_ORIGIN}/ofertas`);
      u.searchParams.set('category', source.categoryId);
      break;
    case 'url':
      try {
        u = new URL(source.url);
      } catch {
        throw invalid('URL da listagem inválida');
      }
      if (u.protocol !== 'https:' || !isMlHost(u.hostname)) {
        throw invalid('Use um link https do Mercado Livre (mercadolivre.com.br)');
      }
      u.hash = '';
      break;
  }
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

/**
 * Limpa o link de um card: descarta patrocinado (click1…) e domínio de terceiros, tira query e
 * fragmento de tracking, mas preserva `#wid=MLB…` em link de catálogo (/p/MLB…), porque a API oficial
 * usa o `wid` para escolher a oferta (ver `extractMlCatalogRef`).
 */
export function cleanMlProductUrl(href: string): string | undefined {
  if (!href.trim()) return undefined;
  let u: URL;
  try {
    u = new URL(href, ML_ORIGIN);
  } catch {
    return undefined;
  }
  if (/^click\d*\./i.test(u.hostname) || !isMlHost(u.hostname)) return undefined;
  const base = `${u.origin}${u.pathname}`;
  const wid = new URLSearchParams(u.hash.replace(/^#/, '')).get('wid') ?? u.searchParams.get('wid');
  const widMatch = wid?.match(/^MLB-?(\d+)$/i);
  if (widMatch && /\/p\/MLB/i.test(u.pathname)) return `${base}#wid=MLB${widMatch[1]}`;
  return base;
}

/** A página de "verificação de conta" do anti-bot (HTTP 200, sem produtos). */
export function isMlVerificationPage(finalUrl: string, html: string): boolean {
  if (/\/gz\/account-verification/.test(finalUrl)) return true;
  const hasCards = /poly-card|dynamic-carousel__item-container/.test(html);
  return !hasCards && /suspicious-traffic|account-verification/.test(html);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
type Sel = ReturnType<cheerio.CheerioAPI>;

/** Preço a partir de um bloco `andes-money-amount` (fração + centavos opcionais). */
function moneyOf(el: Sel): number | undefined {
  if (el.length === 0) return undefined;
  const frac = el.find('.andes-money-amount__fraction').first().text().replace(/\./g, '').trim();
  if (!frac) return undefined;
  const cents = el.find('.andes-money-amount__cents').first().text().trim();
  return parseMoney(cents ? `${frac},${cents}` : frac);
}

/** "R$ 1.299" ou "1.299,90" → número (o ponto sem vírgula é separador de milhar). */
function brlText(raw: string): number | undefined {
  const t = raw.replace(/[^\d.,]/g, '');
  if (!t) return undefined;
  return parseMoney(t.includes(',') ? t : t.replace(/\./g, ''));
}

function discountOf(
  labelText: string,
  price: number,
  originalPrice: number | undefined,
): number | undefined {
  const fromLabel = labelText.match(/(\d+)\s*%/)?.[1];
  if (fromLabel) return Number(fromLabel);
  if (originalPrice !== undefined) {
    return Math.round(((originalPrice - price) / originalPrice) * 100);
  }
  return undefined;
}

function parsePolycards($: cheerio.CheerioAPI, html: string, now: Date): ProductData[] {
  // O horário real da contagem do relâmpago não está no DOM (os dígitos vêm zerados): fica no JSON
  // embutido, uma ocorrência de "period_end" por card com contagem, na ordem do documento.
  const periodEnds = [...html.matchAll(/"period_end"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
  const cards = $('.poly-card').toArray();
  const hasCountdown = (el: (typeof cards)[number]) =>
    $(el).find('.poly-component__highlight-countdown').length > 0;
  const aligned = periodEnds.length === cards.filter(hasCountdown).length;
  let countdownIndex = 0;

  const out: ProductData[] = [];
  for (const el of cards) {
    const card = $(el);

    let flashSaleEndsAt: string | undefined;
    if (hasCountdown(el)) {
      const raw = aligned ? periodEnds[countdownIndex] : undefined;
      countdownIndex++;
      const parsed = raw ? new Date(raw) : undefined;
      flashSaleEndsAt =
        parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : endOfDaySaoPaulo(now);
    }

    const titleEl = card.find('a.poly-component__title').first();
    const title = clean(titleEl.text());
    const url = cleanMlProductUrl(titleEl.attr('href') ?? '');
    if (!title || !url) continue;
    const parsedUrl = parseProductUrl(url);
    if (parsedUrl.source !== 'MERCADOLIVRE') continue;

    const imgEl = card.find('img.poly-component__picture').first();
    const image = [imgEl.attr('src'), imgEl.attr('data-src')].find((s) => s?.startsWith('http'));
    const price = moneyOf(card.find('.poly-price__current .andes-money-amount').first());
    if (!image || !price) continue;

    const previous = moneyOf(card.find('s.andes-money-amount--previous').first());
    const originalPrice = previous !== undefined && previous > price ? previous : undefined;
    const discountPct = discountOf(
      clean(card.find('.poly-price__discount-polylabel').first().text()),
      price,
      originalPrice,
    );
    const priceNote = clean(card.find('.poly-price__unit-description').first().text());

    const shipEl = card.find('.poly-component__shipping-v2');
    const hasFull = shipEl.find('svg[aria-label*="full" i], use[href="#poly_full"]').length > 0;
    const shipping = hasFull ? 'FULL' : /gr[áa]tis/i.test(shipEl.text()) ? 'FREE' : 'UNKNOWN';

    out.push({
      source: 'MERCADOLIVRE',
      ...(parsedUrl.externalId ? { externalId: parsedUrl.externalId } : {}),
      title,
      price,
      ...(originalPrice !== undefined ? { originalPrice } : {}),
      ...(discountPct !== undefined ? { discountPct } : {}),
      images: [image],
      shipping,
      ...(flashSaleEndsAt ? { flashSaleEndsAt } : {}),
      originalUrl: url,
      raw: { origin: 'ml-listing', ...(priceNote ? { priceNote } : {}) },
    });
  }
  return out;
}

function parseCarousel($: cheerio.CheerioAPI): ProductData[] {
  const out: ProductData[] = [];
  $('.dynamic-carousel__item-container').each((_, el) => {
    const card = $(el);
    const title = clean(card.find('.dynamic-carousel__title').first().text());
    const url = cleanMlProductUrl(card.find('a.splinter-link').first().attr('href') ?? '');
    const image = card.find('img').first().attr('src');
    if (!title || !url || !image?.startsWith('http')) return;
    const parsedUrl = parseProductUrl(url);
    if (parsedUrl.source !== 'MERCADOLIVRE') return;

    const intPart = card
      .find('.dynamic-carousel__price span')
      .first()
      .text()
      .replace(/\./g, '')
      .trim();
    const decimals = card.find('.dynamic-carousel__price-decimals').first().text().trim();
    const price = intPart ? brlText(decimals ? `${intPart},${decimals}` : intPart) : undefined;
    if (!price) return;

    const previous = brlText(card.find('.dynamic-carousel__oldprice').first().text());
    const originalPrice = previous !== undefined && previous > price ? previous : undefined;
    const discountPct = discountOf(
      clean(card.find('.dynamic-carousel__discount').first().text()),
      price,
      originalPrice,
    );

    out.push({
      source: 'MERCADOLIVRE',
      ...(parsedUrl.externalId ? { externalId: parsedUrl.externalId } : {}),
      title,
      price,
      ...(originalPrice !== undefined ? { originalPrice } : {}),
      ...(discountPct !== undefined ? { discountPct } : {}),
      images: [image],
      shipping: 'UNKNOWN',
      originalUrl: url,
      raw: { origin: 'ml-listing' },
    });
  });
  return out;
}

/** Produtos de uma página de listagem (cards `poly-card` e, em páginas coladas, o carrossel antigo). */
export function parseMlListingHtml(html: string, now: Date = new Date()): ProductData[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: ProductData[] = [];
  for (const p of [...parsePolycards($, html, now), ...parseCarousel($)]) {
    const key = p.externalId ?? p.originalUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
