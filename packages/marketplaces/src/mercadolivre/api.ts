import type { ProductData } from '@afilados/shared';

// Cliente da API oficial do Mercado Livre para produtos de CATÁLOGO. Ver o design em
// docs/superpowers/specs/2026-09-29-mercadolivre-api-oficial-design.md — em resumo: este app só
// enxerga catálogo (`/products/*`); anúncios individuais (`/items/{id}`) e a busca de anúncios
// (`/sites/MLB/search`) respondem 403, e a API não informa preço original nem desconto.

const DEFAULT_BASE_URL = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB';
const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];
const SERVER_ERROR_RETRY_MS = 1000;
const MAX_IMAGES = 6;

export type MlApiErrorCode =
  'ML_API_UNAUTHORIZED' | 'ML_API_RATE_LIMITED' | 'ML_API_NOT_FOUND' | 'ML_API_ERROR';

export class MlApiError extends Error {
  constructor(
    message: string,
    public readonly code: MlApiErrorCode,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'MlApiError';
  }
}

export interface MlApiOptions {
  fetchImpl?: typeof fetch;
  /** Espera entre tentativas (injetável em testes). */
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export interface MlPicture {
  id?: string | undefined;
  url?: string | undefined;
  secure_url?: string | undefined;
}

export interface MlCatalogProduct {
  id: string;
  name?: string | undefined;
  family_name?: string | undefined;
  pictures?: MlPicture[] | undefined;
  status?: string | undefined;
  parent_id?: string | null | undefined;
}

export interface MlOffer {
  item_id: string;
  price: number;
  condition?: string | undefined;
  seller_id?: number | undefined;
  currency_id?: string | undefined;
  inventory_id?: string | null | undefined;
  deal_ids?: string[] | undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET autenticado. 429 repete com backoff exponencial (1s, 2s, 4s); erro 5xx ou de rede repete
 * uma vez. 401/403 → ML_API_UNAUTHORIZED, 404 → ML_API_NOT_FOUND.
 */
async function mlApiGet<T>(path: string, accessToken: string, opts: MlApiOptions = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const url = `${opts.baseUrl ?? DEFAULT_BASE_URL}${path}`;

  let rateLimitAttempts = 0;
  let retriedServerError = false;
  for (;;) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
    } catch (err) {
      if (!retriedServerError) {
        retriedServerError = true;
        await sleep(SERVER_ERROR_RETRY_MS);
        continue;
      }
      throw new MlApiError(`Falha de rede na API do Mercado Livre: ${String(err)}`, 'ML_API_ERROR');
    }

    if (res.ok) return (await res.json()) as T;

    if (res.status === 401 || res.status === 403) {
      throw new MlApiError(
        'API do Mercado Livre recusou o acesso (token inválido ou sem permissão)',
        'ML_API_UNAUTHORIZED',
        res.status,
      );
    }
    if (res.status === 404) {
      throw new MlApiError(
        'Recurso não encontrado na API do Mercado Livre',
        'ML_API_NOT_FOUND',
        404,
      );
    }
    if (res.status === 429) {
      if (rateLimitAttempts >= RATE_LIMIT_BACKOFF_MS.length) {
        throw new MlApiError(
          'Limite de requisições da API do Mercado Livre excedido',
          'ML_API_RATE_LIMITED',
          429,
        );
      }
      await sleep(RATE_LIMIT_BACKOFF_MS[rateLimitAttempts]!);
      rateLimitAttempts++;
      continue;
    }
    if (res.status >= 500 && !retriedServerError) {
      retriedServerError = true;
      await sleep(SERVER_ERROR_RETRY_MS);
      continue;
    }
    throw new MlApiError(
      `API do Mercado Livre respondeu HTTP ${res.status}`,
      'ML_API_ERROR',
      res.status,
    );
  }
}

/**
 * Reconhece um link de PRODUTO DE CATÁLOGO (`…/p/MLB123`) e devolve o ID do produto e, se a URL
 * trouxer `wid=` (query ou fragmento — formato dos cards de busca), o ID da oferta clicada.
 * Links de anúncio individual (`MLB-123-…`) e listagens não resolvem: dependem de endpoints que
 * respondem 403 para este app.
 */
export function extractMlCatalogRef(
  rawUrl: string,
): { productId: string; offerId?: string } | undefined {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (u.hostname !== 'mercadolivre.com.br' && !u.hostname.endsWith('.mercadolivre.com.br')) {
    return undefined;
  }
  const match = u.pathname.match(/\/p\/(MLB\d+)/i);
  if (!match) return undefined;
  const productId = match[1]!.toUpperCase();

  const rawWid =
    u.searchParams.get('wid') ?? new URLSearchParams(u.hash.replace(/^#/, '')).get('wid');
  const wid = rawWid?.match(/^MLB-?(\d+)$/i);
  return wid ? { productId, offerId: `MLB${wid[1]}` } : { productId };
}

export function fetchCatalogProduct(
  productId: string,
  accessToken: string,
  opts?: MlApiOptions,
): Promise<MlCatalogProduct> {
  return mlApiGet<MlCatalogProduct>(`/products/${productId}`, accessToken, opts);
}

/** Ofertas ativas do produto, na ordem da API (a primeira é a principal da página). 404 = sem oferta. */
export async function fetchProductOffers(
  productId: string,
  accessToken: string,
  opts?: MlApiOptions,
): Promise<MlOffer[]> {
  try {
    const res = await mlApiGet<{ results?: MlOffer[] }>(
      `/products/${productId}/items?limit=10`,
      accessToken,
      opts,
    );
    return res.results ?? [];
  } catch (err) {
    if (err instanceof MlApiError && err.code === 'ML_API_NOT_FOUND') return [];
    throw err;
  }
}

export async function searchCatalogProducts(
  keyword: string,
  accessToken: string,
  opts: MlApiOptions & { limit?: number } = {},
): Promise<MlCatalogProduct[]> {
  const limit = opts.limit ?? 20;
  const res = await mlApiGet<{ results?: MlCatalogProduct[] }>(
    `/products/search?status=active&site_id=${SITE_ID}&q=${encodeURIComponent(keyword)}&limit=${limit}`,
    accessToken,
    opts,
  );
  return res.results ?? [];
}

/**
 * Descoberta por palavra-chave: URLs de catálogo (`/p/MLB…`) dos produtos encontrados. Muitos
 * resultados estão indisponíveis (sem oferta); quem resolve as URLs descarta esses.
 */
export async function discoverMlCatalogUrls(
  keyword: string,
  accessToken: string,
  opts?: MlApiOptions,
): Promise<string[]> {
  const products = await searchCatalogProducts(keyword, accessToken, { ...opts, limit: 30 });
  return products.map((p) => `https://www.mercadolivre.com.br/p/${p.id}`);
}

/**
 * Monta o ProductData de um produto de catálogo. A oferta usada é a do `wid` (se informado), senão
 * a primeira nova — a API devolve a principal da página primeiro, não a mais barata. Devolve
 * undefined quando o produto não tem título ou não tem oferta com preço válido (indisponível).
 * `price` é o preço de LISTA: a API não traz preço original nem os descontos de Pix/cupom.
 */
export function mapMlCatalogProduct(
  product: MlCatalogProduct,
  offers: MlOffer[],
  originalUrl: string,
  offerId?: string,
): ProductData | undefined {
  const title = product.name?.trim() || product.family_name?.trim();
  if (!title) return undefined;

  const valid = offers.filter((o) => Number.isFinite(o.price) && o.price > 0);
  const chosen =
    (offerId ? valid.find((o) => o.item_id === offerId) : undefined) ??
    valid.find((o) => o.condition === 'new') ??
    valid[0];
  if (!chosen) return undefined;

  const images: string[] = [];
  for (const picture of product.pictures ?? []) {
    const src = picture.url || picture.secure_url;
    if (src && src.startsWith('http') && !images.includes(src)) images.push(src);
    if (images.length >= MAX_IMAGES) break;
  }

  return {
    source: 'MERCADOLIVRE',
    externalId: product.id,
    title,
    price: chosen.price,
    images,
    shipping: chosen.inventory_id ? 'FULL' : 'UNKNOWN',
    originalUrl,
    raw: {
      source: 'ml-api',
      productId: product.id,
      offerId: chosen.item_id,
      offers: offers.length,
      sellerId: chosen.seller_id,
    },
  };
}
