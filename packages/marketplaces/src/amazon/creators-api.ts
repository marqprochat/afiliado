/**
 * Cliente da Creators API da Amazon (sucessora oficial da PA-API 5.0), usada para buscar
 * dados de produto (GetItems) com as credenciais de Associado do tenant.
 *
 * Doc: https://associados.amazon.com.br/creatorsapi/docs/en-us/introduction
 * Spec: docs/superpowers/specs/2026-09-21-amazon-creators-api-design.md
 */

import type { ProductData } from '@afilados/shared';

const AMAZON_TOKEN_ENDPOINT_DEFAULT = 'https://api.amazon.com/auth/o2/token';
const AMAZON_CREATORS_API_BASE_URL_DEFAULT = 'https://creatorsapi.amazon';
const AMAZON_CREATORS_API_MARKETPLACE_BR = 'www.amazon.com.br';
/** Cota inicial da Creators API é 1 TPS — mantemos esse teto fixo mesmo quando a conta ganha mais. */
const MIN_REQUEST_INTERVAL_MS = 1000;
/** Renova o token um pouco antes de expirar, para não arriscar usar um token vencido em voo. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class AmazonApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AMAZON_API_UNAUTHORIZED'
      | 'AMAZON_API_RATE_LIMITED'
      | 'AMAZON_API_ITEM_NOT_FOUND'
      | 'AMAZON_API_ERROR',
  ) {
    super(message);
    this.name = 'AmazonApiError';
  }
}

export interface AmazonApiCredentials {
  clientId: string;
  clientSecret: string;
  partnerTag: string;
}

export interface AmazonApiOptions {
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  baseUrl?: string;
  marketplace?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const lastCallAt = new Map<string, number>();

/** Limpa os caches em memória — só para uso em testes, evita estado vazando entre `it`s. */
export function resetAmazonApiState(): void {
  tokenCache.clear();
  lastCallAt.clear();
}

export async function getAccessToken(
  creds: Pick<AmazonApiCredentials, 'clientId' | 'clientSecret'>,
  opts: AmazonApiOptions = {},
): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && cached.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return cached.token;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.tokenEndpoint ?? AMAZON_TOKEN_ENDPOINT_DEFAULT;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'creatorsapi::default',
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AmazonApiError('Credenciais da Creators API inválidas', 'AMAZON_API_UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new AmazonApiError(`Token da Creators API respondeu HTTP ${res.status}`, 'AMAZON_API_ERROR');
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new AmazonApiError('Resposta de token sem access_token', 'AMAZON_API_ERROR');
  }
  const expiresIn = data.expires_in ?? 3600;
  tokenCache.set(creds.clientId, { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return data.access_token;
}

/** Espera o mínimo necessário para respeitar 1 req/s por `clientId` antes de uma chamada. */
export async function waitForRateLimitSlot(clientId: string): Promise<void> {
  const last = lastCallAt.get(clientId) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastCallAt.set(clientId, Date.now());
}

export {
  AMAZON_TOKEN_ENDPOINT_DEFAULT,
  AMAZON_CREATORS_API_BASE_URL_DEFAULT,
  AMAZON_CREATORS_API_MARKETPLACE_BR,
};

export interface AmazonApiItem {
  asin: string;
  parentASIN?: string;
  images?: { primary?: { large?: { url?: string } } };
  itemInfo?: { title?: { displayValue?: string } };
  offersV2?: {
    listings?: Array<{
      price?: {
        money?: { amount?: number; currency?: string };
        savings?: { percentage?: number; money?: { amount?: number } };
      };
    }>;
  };
}

interface AmazonGetItemsResponse {
  itemResults?: { items?: AmazonApiItem[] };
  errors?: Array<{ code?: string; message?: string }>;
}

const GET_ITEMS_RESOURCES = [
  'itemInfo.title',
  'images.primary.large',
  'offersV2.listings.price',
  'parentASIN',
];

async function getItemsBatch(
  asins: string[],
  creds: AmazonApiCredentials,
  opts: AmazonApiOptions,
): Promise<AmazonApiItem[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? AMAZON_CREATORS_API_BASE_URL_DEFAULT;
  const marketplace = opts.marketplace ?? AMAZON_CREATORS_API_MARKETPLACE_BR;
  await waitForRateLimitSlot(creds.clientId);
  const token = await getAccessToken(creds, opts);
  const res = await doFetch(`${baseUrl}/catalog/v1/getItems`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-marketplace': marketplace,
    },
    body: JSON.stringify({
      itemIds: asins,
      itemIdType: 'ASIN',
      marketplace,
      partnerTag: creds.partnerTag,
      resources: GET_ITEMS_RESOURCES,
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AmazonApiError('Credenciais da Creators API inválidas', 'AMAZON_API_UNAUTHORIZED');
  }
  if (res.status === 429) {
    throw new AmazonApiError('Cota da Creators API excedida (429)', 'AMAZON_API_RATE_LIMITED');
  }
  if (!res.ok) {
    throw new AmazonApiError(`GetItems respondeu HTTP ${res.status}`, 'AMAZON_API_ERROR');
  }
  const data = (await res.json()) as AmazonGetItemsResponse;
  return data.itemResults?.items ?? [];
}

/** ASINs em lotes de até 10 (limite do GetItems), respeitando o rate limit entre lotes. */
export async function getItems(
  asins: string[],
  creds: AmazonApiCredentials,
  opts: AmazonApiOptions = {},
): Promise<AmazonApiItem[]> {
  const items: AmazonApiItem[] = [];
  for (let i = 0; i < asins.length; i += 10) {
    const batch = asins.slice(i, i + 10);
    items.push(...(await getItemsBatch(batch, creds, opts)));
  }
  return items;
}

export function extractAsin(url: string): string | undefined {
  const match =
    url.match(/\/dp\/([A-Z0-9]{10})/i) ||
    url.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
    url.match(/\/product\/([A-Z0-9]{10})/i);
  return match?.[1]?.toUpperCase();
}

export function mapCreatorsApiItem(item: AmazonApiItem, originalUrl: string): ProductData {
  const title = item.itemInfo?.title?.displayValue ?? 'Produto Amazon';
  const imageUrl = item.images?.primary?.large?.url;
  const listing = item.offersV2?.listings?.[0];
  const currentPrice = listing?.price?.money?.amount;
  const savingsPct = listing?.price?.savings?.percentage;
  const savingsAmount = listing?.price?.savings?.money?.amount;
  const originalPrice =
    currentPrice !== undefined && savingsAmount !== undefined
      ? Math.round((currentPrice + savingsAmount) * 100) / 100
      : undefined;
  return {
    source: 'AMAZON',
    externalId: item.asin,
    title,
    price: currentPrice ?? 0,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(savingsPct !== undefined ? { discountPct: Math.round(savingsPct) } : {}),
    images: imageUrl ? [imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl,
    raw: item,
  };
}
