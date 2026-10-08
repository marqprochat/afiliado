import * as cheerio from 'cheerio';
import type { ProductData } from '@afilados/shared';
import { cookieHeader } from '../mercadolivre/official-link';

/**
 * Busca de ofertas da Amazon pelo HTML das listagens, sem abrir a página de cada produto:
 * - `deals`: busca por palavra-chave no departamento Ofertas (`/s?k=<termo>&i=pbdd`), com preço atual,
 *   preço riscado e selo (Oferta, Mega Oferta Prime…) em cada card;
 * - `mega`: a página `/megaofertaprime`, uma vitrine de carrosséis sem paginação.
 * Anônima ela responde bem a partir de IP residencial; os cookies da sessão só entram como segunda
 * tentativa quando a Amazon devolve captcha ou a casca vazia.
 */

const AMAZON_ORIGIN = 'https://www.amazon.com.br';

export type AmazonListingSource = { kind: 'deals'; query: string } | { kind: 'mega' };

export type AmazonListingErrorCode =
  | 'AMAZON_LISTING_BLOCKED'
  | 'AMAZON_LISTING_LAYOUT'
  | 'AMAZON_LISTING_INVALID_QUERY'
  | 'AMAZON_LISTING_HTTP';

export class AmazonListingError extends Error {
  constructor(
    message: string,
    public readonly code: AmazonListingErrorCode,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'AmazonListingError';
  }
}

/** URL da página `page` (1-based) da fonte. A vitrine `mega` não pagina. */
export function buildAmazonListingUrl(source: AmazonListingSource, page: number): string {
  if (source.kind === 'mega') return `${AMAZON_ORIGIN}/megaofertaprime`;
  const query = source.query.trim();
  if (!query) {
    throw new AmazonListingError('Informe uma palavra-chave', 'AMAZON_LISTING_INVALID_QUERY');
  }
  const u = new URL(`${AMAZON_ORIGIN}/s`);
  u.searchParams.set('k', query);
  u.searchParams.set('i', 'pbdd');
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

const HAS_CARDS = /data-component-type="s-search-result"|dcl-product-wrapper/;

/** Captcha ("robot check"): a Amazon não entregou a listagem. */
export function isAmazonBlockedPage(html: string): boolean {
  return (
    !HAS_CARDS.test(html) &&
    /validateCaptcha|api-services-support@amazon|Digite os caracteres/i.test(html)
  );
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "R$ 1.299,90" → 1299.9 */
function brl(raw: string): number | undefined {
  const t = raw.replace(/[^\d.,]/g, '');
  if (!t) return undefined;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "/Nunca-minta-Freida-McFadden/dp/8501923281?x=1" → "Nunca minta Freida McFadden" */
function titleFromSlug(href: string | undefined): string {
  const slug = href?.match(/^\/([^/?#]+)\/dp\//)?.[1];
  if (!slug) return '';
  try {
    return clean(decodeURIComponent(slug).replace(/-/g, ' '));
  } catch {
    return '';
  }
}

function productUrl(asin: string): string {
  return `${AMAZON_ORIGIN}/dp/${asin}`;
}

type Priced = { price: number; originalPrice?: number; discountPct?: number };

/** Preço atual + riscado (descartado se ≤ atual) + desconto do rótulo "N% off" ou calculado. */
function priced(
  price: number | undefined,
  previous: number | undefined,
  label: string,
): Priced | undefined {
  if (!price) return undefined;
  const originalPrice = previous !== undefined && previous > price ? previous : undefined;
  const fromLabel = label.match(/(\d+)\s*%\s*off/i)?.[1];
  const discountPct = fromLabel
    ? Number(fromLabel)
    : originalPrice !== undefined
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : undefined;
  return {
    price,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discountPct !== undefined ? { discountPct } : {}),
  };
}

/** Cards da busca (`/s`): título, imagem, preço atual e riscado, frete e selo. */
export function parseAmazonSearchHtml(html: string): ProductData[] {
  const $ = cheerio.load(html);
  const out: ProductData[] = [];
  $('div[data-component-type="s-search-result"]').each((_, el) => {
    const card = $(el);
    const asin = card.attr('data-asin');
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;

    const title = clean(card.find('h2').first().text());
    const image = card.find('img.s-image').first().attr('src');
    const p = priced(
      brl(card.find('.a-price:not(.a-text-price) .a-offscreen').first().text()),
      brl(card.find('.a-price.a-text-price .a-offscreen').first().text()),
      '',
    );
    if (!title || !image?.startsWith('http') || !p) return;

    const badge = clean(card.find('[data-a-badge-type], .a-badge-text').first().text());
    const sponsored = card.find('[class*="sponsored"]').length > 0;
    const freeShipping = /(entrega|frete)\s+gr[áa]tis/i.test(card.text());

    out.push({
      source: 'AMAZON',
      externalId: asin,
      title,
      ...p,
      images: [image],
      shipping: freeShipping ? 'FREE' : 'UNKNOWN',
      originalUrl: productUrl(asin),
      raw: {
        origin: 'amazon-listing',
        ...(badge ? { badge } : {}),
        ...(sponsored ? { sponsored: true } : {}),
        ...(freeShipping ? { freeShipping: true } : {}),
      },
    });
  });
  return out;
}

/** Cards dos carrosséis da `/megaofertaprime` (`li.dcl-carousel-element`), com o "% off" do selo. */
export function parseAmazonMegaHtml(html: string): ProductData[] {
  const $ = cheerio.load(html);
  const out: ProductData[] = [];
  $('li.dcl-carousel-element').each((_, el) => {
    const card = $(el);
    const asin = card
      .find('[data-csa-c-item-id]')
      .first()
      .attr('data-csa-c-item-id')
      ?.match(/asin\.([A-Z0-9]{10})/)?.[1];
    if (!asin) return;

    const img = card.find('.dcl-product-image-container img').first();
    // alguns cards (livros) vêm com o alt vazio: o título então sai do slug do link ("/Nunca-minta-X/dp/…")
    const title =
      clean(img.attr('alt') ?? '') || titleFromSlug(card.find('a.dcl-product-link').attr('href'));
    const image = img.attr('src');
    const badgeTexts = card
      .find('.dcl-badge span.a-size-mini')
      .toArray()
      .map((s) => clean($(s).text()));
    const p = priced(
      brl(card.find('.dcl-product-price-new .a-offscreen').first().text()),
      brl(card.find('.dcl-product-price-old .a-offscreen').first().text()),
      badgeTexts.find((t) => /%\s*off/i.test(t)) ?? '',
    );
    if (!title || !image?.startsWith('http') || !p) return;

    const badge = badgeTexts.find((t) => t && !/%\s*off/i.test(t));
    out.push({
      source: 'AMAZON',
      externalId: asin,
      title,
      ...p,
      images: [image],
      shipping: 'UNKNOWN',
      originalUrl: productUrl(asin),
      raw: { origin: 'amazon-listing', ...(badge ? { badge } : {}) },
    });
  });
  return out;
}

/** Produtos de uma página da fonte, sem repetir ASIN. */
export function parseAmazonListingHtml(source: AmazonListingSource, html: string): ProductData[] {
  const parsed = source.kind === 'mega' ? parseAmazonMegaHtml(html) : parseAmazonSearchHtml(html);
  const seen = new Set<string>();
  return parsed.filter((p) => {
    const key = p.externalId ?? p.originalUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const AMAZON_LISTING_MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 15_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

export interface FetchAmazonListingOptions {
  /** Quantos produtos (que passem em `filter`) juntar antes de parar. */
  limit: number;
  /** Cookies da sessão sincronizada; usados só quando a página anônima vem bloqueada. */
  cookies?: Record<string, string> | undefined;
  /** Aplicado a cada produto durante a paginação (desconto, preço, palavra-chave…). */
  filter?: ((product: ProductData) => boolean) | undefined;
  maxPages?: number | undefined;
  /** Injetáveis em testes. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface LoadedPage {
  html: string;
  blockedStatus: boolean;
}

/**
 * Lê a listagem página a página. Cada página é pedida primeiro sem cookies; se vier bloqueada
 * (captcha, HTTP 403/429/503 ou a casca sem cards) e houver sessão sincronizada, repete com ela. Na
 * página 1 os erros sobem (`AmazonListingError`); a partir da página 2 qualquer falha só encerra a
 * paginação com o que já veio.
 */
export async function fetchAmazonListing(
  source: AmazonListingSource,
  opts: FetchAmazonListingOptions,
): Promise<ProductData[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPages = source.kind === 'mega' ? 1 : (opts.maxPages ?? AMAZON_LISTING_MAX_PAGES);
  const cookie =
    opts.cookies && Object.keys(opts.cookies).length > 0 ? cookieHeader(opts.cookies) : '';

  async function load(url: string, withCookie: boolean): Promise<LoadedPage> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          ...(withCookie ? { Cookie: cookie } : {}),
        },
      });
      // 503 é a resposta clássica de "robot check" da Amazon
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        return { html: '', blockedStatus: true };
      }
      if (!res.ok) {
        throw new AmazonListingError(
          `A Amazon respondeu HTTP ${res.status}`,
          'AMAZON_LISTING_HTTP',
          url,
        );
      }
      return { html: await res.text(), blockedStatus: false };
    } finally {
      clearTimeout(timer);
    }
  }
  // Sem cards a página é "casca": captcha, ou a resposta de 1 KB que a Amazon dá a IP suspeito.
  const isShell = (p: LoadedPage) =>
    p.blockedStatus || isAmazonBlockedPage(p.html) || !HAS_CARDS.test(p.html);

  const out: ProductData[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages && out.length < opts.limit; page++) {
    const url = buildAmazonListingUrl(source, page); // lança AMAZON_LISTING_INVALID_QUERY antes de qualquer requisição
    let loaded: LoadedPage;
    try {
      loaded = await load(url, false);
      if (isShell(loaded) && cookie) loaded = await load(url, true);
    } catch (err) {
      if (page > 1) break;
      if (err instanceof AmazonListingError) throw err;
      // Rede fora do ar ou 15 s estourados: vira erro tipado para o chamador mostrar mensagem em português.
      throw new AmazonListingError(
        'Falha de rede ou tempo esgotado ao ler a listagem da Amazon',
        'AMAZON_LISTING_HTTP',
        `${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (isShell(loaded)) {
      if (page > 1) break;
      throw new AmazonListingError(
        cookie
          ? 'A Amazon bloqueou a listagem mesmo com a sessão sincronizada; a sessão pode ter expirado'
          : 'A Amazon bloqueou a listagem (verificação anti-robô) e não há sessão sincronizada',
        'AMAZON_LISTING_BLOCKED',
        url,
      );
    }

    const products = parseAmazonListingHtml(source, loaded.html);
    if (products.length === 0) {
      if (page > 1) break;
      throw new AmazonListingError(
        'A página de ofertas da Amazon mudou de layout e nenhum produto foi reconhecido',
        'AMAZON_LISTING_LAYOUT',
        `${url} (${loaded.html.length} bytes)`,
      );
    }

    let added = 0;
    for (const p of products) {
      const key = p.externalId ?? p.originalUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      added++;
      if (opts.filter && !opts.filter(p)) continue;
      out.push(p);
      if (out.length >= opts.limit) break;
    }
    if (added === 0) break; // a paginação repetiu a mesma página: acabou
    if (page < maxPages && out.length < opts.limit) {
      await sleep(1000 + Math.floor(Math.random() * 1000));
    }
  }
  return out;
}
