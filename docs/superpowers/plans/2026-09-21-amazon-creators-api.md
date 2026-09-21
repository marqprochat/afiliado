# Amazon Creators API (GetItems) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HTML scraping of Amazon product pages with the official Creators API (`GetItems`), so product data (title, price, discount, image) comes from a stable authenticated endpoint instead of parsing HTML.

**Architecture:** New module `packages/marketplaces/src/amazon/creators-api.ts` implements OAuth2 client-credentials auth (cached token), a rate-limited/batched `getItems` call, and a mapper to the existing `ProductData` shape. `tag-adapter.ts`'s Amazon branch calls this instead of `scrapeAmazon`, with no fallback on failure. New `amazonApi` credentials (Client ID/Secret) are added to the existing per-tenant encrypted `TagCredentials`, exposed through the existing marketplace config UI/API. Every caller that today invokes `getTagAdapter('AMAZON').fetchByUrls({}, ...)` with empty credentials must be updated to load and pass the tenant's real credentials, since GetItems (unlike scraping) needs them to do anything.

**Tech Stack:** TypeScript, native `fetch`, Vitest, Fastify (api), BullMQ (worker), Next.js (web), Prisma (`@afilados/db`).

## Global Constraints

- No fallback to scraping if the Creators API call fails (401/429/network/parse error) — the product for that URL/ASIN is simply not returned. This is a deliberate decision from the approved spec, not an omission.
- No automatic retry on `429` — quota is fixed and conservative (throttle to 1 request/second per `clientId`), not adaptive.
- Never return the `clientSecret` value in any API response — only a `hasAmazonApiSecret: boolean`, mirroring the existing `hasSecret` pattern for Shopee.
- `toAffiliateLink` (SiteStripe/tag link generation) is unchanged — out of scope.
- `SearchItems`/category search and `GetBrowseNodes` are unchanged — out of scope (explicitly deferred, see spec).
- Reference spec: `docs/superpowers/specs/2026-09-21-amazon-creators-api-design.md`.

---

## Task 1: Creators API — OAuth token + rate-limited HTTP client

**Files:**
- Create: `packages/marketplaces/src/amazon/creators-api.ts`
- Test: `packages/marketplaces/test/amazon-creators-api.test.ts`

**Interfaces:**
- Produces: `export class AmazonApiError extends Error { code: 'AMAZON_API_UNAUTHORIZED' | 'AMAZON_API_RATE_LIMITED' | 'AMAZON_API_ITEM_NOT_FOUND' | 'AMAZON_API_ERROR' }`
- Produces: `export interface AmazonApiCredentials { clientId: string; clientSecret: string; partnerTag: string }`
- Produces: `export interface AmazonApiOptions { fetchImpl?: typeof fetch; tokenEndpoint?: string; baseUrl?: string; marketplace?: string }`
- Produces: `export async function getAccessToken(creds: Pick<AmazonApiCredentials, 'clientId' | 'clientSecret'>, opts?: AmazonApiOptions): Promise<string>`
- Produces (internal, used by Task 2): `export function resetAmazonApiState(): void` — clears the module-level token/rate-limit caches; test-only helper so tests don't leak state into each other.

- [ ] **Step 1: Write the failing tests**

Create `packages/marketplaces/test/amazon-creators-api.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonApiError, getAccessToken, resetAmazonApiState } from '../src/amazon/creators-api';

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('getAccessToken', () => {
  beforeEach(() => {
    resetAmazonApiState();
  });

  it('faz POST no endpoint de token com client_credentials e devolve o access_token', async () => {
    const fetchImpl = fetchReturning(200, {
      access_token: 'tok-123',
      token_type: 'bearer',
      expires_in: 3600,
    });
    const token = await getAccessToken(
      { clientId: 'cid', clientSecret: 'csecret' },
      { fetchImpl, tokenEndpoint: 'https://api.amazon.com/auth/o2/token' },
    );
    expect(token).toBe('tok-123');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: 'cid',
          client_secret: 'csecret',
          scope: 'creatorsapi::default',
        }),
      }),
    );
  });

  it('cacheia o token e não faz nova chamada enquanto ele não expirar', async () => {
    const fetchImpl = fetchReturning(200, { access_token: 'tok-abc', expires_in: 3600 });
    const creds = { clientId: 'cid2', clientSecret: 'csecret2' };
    await getAccessToken(creds, { fetchImpl });
    await getAccessToken(creds, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lança AmazonApiError(AMAZON_API_UNAUTHORIZED) em 401', async () => {
    const fetchImpl = fetchReturning(401, { error: 'invalid_client' });
    await expect(
      getAccessToken({ clientId: 'bad', clientSecret: 'bad' }, { fetchImpl }),
    ).rejects.toThrow(AmazonApiError);
    try {
      await getAccessToken({ clientId: 'bad2', clientSecret: 'bad2' }, { fetchImpl });
    } catch (err) {
      expect((err as AmazonApiError).code).toBe('AMAZON_API_UNAUTHORIZED');
    }
  });

  it('lança AmazonApiError(AMAZON_API_ERROR) em outros erros HTTP', async () => {
    const fetchImpl = fetchReturning(500, {});
    await expect(
      getAccessToken({ clientId: 'x', clientSecret: 'y' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'AMAZON_API_ERROR' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/marketplaces && npx vitest run test/amazon-creators-api.test.ts
```
Expected: FAIL — `Cannot find module '../src/amazon/creators-api'`.

- [ ] **Step 3: Implement the token client**

Create `packages/marketplaces/src/amazon/creators-api.ts`:

```ts
/**
 * Cliente da Creators API da Amazon (sucessora oficial da PA-API 5.0), usada para buscar
 * dados de produto (GetItems) com as credenciais de Associado do tenant.
 *
 * Doc: https://associados.amazon.com.br/creatorsapi/docs/en-us/introduction
 * Spec: docs/superpowers/specs/2026-09-21-amazon-creators-api-design.md
 */

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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/marketplaces && npx vitest run test/amazon-creators-api.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/marketplaces/src/amazon/creators-api.ts packages/marketplaces/test/amazon-creators-api.test.ts
git commit -m "feat(marketplaces): cliente OAuth2 da Creators API da Amazon (token + rate limit)"
```

---

## Task 2: GetItems (batching) + mapeamento para ProductData

**Files:**
- Modify: `packages/marketplaces/src/amazon/creators-api.ts`
- Modify: `packages/marketplaces/test/amazon-creators-api.test.ts`

**Interfaces:**
- Consumes: `AmazonApiError`, `getAccessToken`, `waitForRateLimitSlot`, `AmazonApiCredentials`, `AmazonApiOptions`, `AMAZON_CREATORS_API_BASE_URL_DEFAULT`, `AMAZON_CREATORS_API_MARKETPLACE_BR` (Task 1)
- Produces: `export interface AmazonApiItem { asin: string; parentASIN?: string; images?: { primary?: { large?: { url?: string } } }; itemInfo?: { title?: { displayValue?: string } }; offersV2?: { listings?: Array<{ price?: { money?: { amount?: number; currency?: string }; savings?: { percentage?: number; money?: { amount?: number } } } }> } }`
- Produces: `export function extractAsin(url: string): string | undefined`
- Produces: `export async function getItems(asins: string[], creds: AmazonApiCredentials, opts?: AmazonApiOptions): Promise<AmazonApiItem[]>`
- Produces: `export function mapCreatorsApiItem(item: AmazonApiItem, originalUrl: string): ProductData` (uses `ProductData` from `@afilados/shared`)

- [ ] **Step 1: Write the failing tests**

Append to `packages/marketplaces/test/amazon-creators-api.test.ts`:

```ts
import { extractAsin, getItems, mapCreatorsApiItem, type AmazonApiItem } from '../src/amazon/creators-api';

describe('extractAsin', () => {
  it('extrai o ASIN de /dp/, /gp/product/ e /product/', () => {
    expect(extractAsin('https://www.amazon.com.br/dp/B09B8V1LZ3')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/gp/product/B09B8V1LZ3/ref=x')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/algo/product/B09B8V1LZ3')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/busca?q=teste')).toBeUndefined();
  });
});

describe('getItems', () => {
  beforeEach(() => {
    resetAmazonApiState();
  });

  const creds = { clientId: 'cid', clientSecret: 'csecret', partnerTag: 'minha-20' };

  it('faz POST em <baseUrl>/catalog/v1/getItems com itemIds, partnerTag e resources', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemResults: { items: [{ asin: 'B09B8V1LZ3' }] } }),
      };
    }) as unknown as typeof fetch;

    const items = await getItems(['B09B8V1LZ3'], creds, {
      fetchImpl,
      baseUrl: 'https://creatorsapi.amazon',
    });

    expect(items).toEqual([{ asin: 'B09B8V1LZ3' }]);
    const getItemsCall = calls.find((c) => c.url.includes('/catalog/v1/getItems'))!;
    expect(getItemsCall.url).toBe('https://creatorsapi.amazon/catalog/v1/getItems');
    const body = JSON.parse(getItemsCall.init.body as string);
    expect(body).toMatchObject({
      itemIds: ['B09B8V1LZ3'],
      itemIdType: 'ASIN',
      partnerTag: 'minha-20',
      marketplace: 'www.amazon.com.br',
    });
    expect(body.resources).toEqual(
      expect.arrayContaining(['itemInfo.title', 'images.primary.large', 'offersV2.listings.price', 'parentASIN']),
    );
    expect(getItemsCall.init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('divide mais de 10 ASINs em lotes de até 10', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      bodies.push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({ itemResults: { items: [] } }) };
    }) as unknown as typeof fetch;

    const asins = Array.from({ length: 12 }, (_, i) => `ASIN${String(i).padStart(6, '0')}`);
    await getItems(asins, creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' });

    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { itemIds: string[] }).itemIds).toHaveLength(10);
    expect((bodies[1] as { itemIds: string[] }).itemIds).toHaveLength(2);
  });

  it('lança AmazonApiError(AMAZON_API_RATE_LIMITED) em 429', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: false, status: 429, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await expect(
      getItems(['B09B8V1LZ3'], creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' }),
    ).rejects.toMatchObject({ code: 'AMAZON_API_RATE_LIMITED' });
  });
});

describe('mapCreatorsApiItem', () => {
  it('mapeia título, imagem, preço e desconto quando presentes', () => {
    const item: AmazonApiItem = {
      asin: 'B09B8V1LZ3',
      itemInfo: { title: { displayValue: 'Echo Dot 5ª Geração' } },
      images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/x.jpg' } } },
      offersV2: {
        listings: [
          { price: { money: { amount: 299, currency: 'BRL' }, savings: { percentage: 30, money: { amount: 130 } } } },
        ],
      },
    };
    const product = mapCreatorsApiItem(item, 'https://www.amazon.com.br/dp/B09B8V1LZ3');
    expect(product.source).toBe('AMAZON');
    expect(product.externalId).toBe('B09B8V1LZ3');
    expect(product.title).toBe('Echo Dot 5ª Geração');
    expect(product.price).toBe(299);
    expect(product.originalPrice).toBe(429);
    expect(product.discountPct).toBe(30);
    expect(product.images).toEqual(['https://m.media-amazon.com/images/I/x.jpg']);
    expect(product.originalUrl).toBe('https://www.amazon.com.br/dp/B09B8V1LZ3');
  });

  it('não lança erro e usa defaults quando faltam preço/imagem', () => {
    const item: AmazonApiItem = { asin: 'B0X', itemInfo: { title: { displayValue: 'Sem preço' } } };
    const product = mapCreatorsApiItem(item, 'https://www.amazon.com.br/dp/B0X');
    expect(product.price).toBe(0);
    expect(product.images).toEqual([]);
    expect(product.originalPrice).toBeUndefined();
    expect(product.discountPct).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/marketplaces && npx vitest run test/amazon-creators-api.test.ts
```
Expected: FAIL — `extractAsin`/`getItems`/`mapCreatorsApiItem` are not exported yet.

- [ ] **Step 3: Implement `getItems`, `extractAsin` and `mapCreatorsApiItem`**

Append to `packages/marketplaces/src/amazon/creators-api.ts` (add `import type { ProductData } from '@afilados/shared';` at the top of the file):

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/marketplaces && npx vitest run test/amazon-creators-api.test.ts
```
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/marketplaces/src/amazon/creators-api.ts packages/marketplaces/test/amazon-creators-api.test.ts
git commit -m "feat(marketplaces): GetItems em lote + mapeamento para ProductData"
```

---

## Task 3: Trocar o scraper da Amazon pelo GetItems no tag-adapter

**Files:**
- Modify: `packages/marketplaces/src/tag-adapter.ts`
- Modify: `packages/marketplaces/src/scrapers/index.ts`
- Delete: `packages/marketplaces/src/scrapers/amazon.ts`
- Modify: `packages/marketplaces/test/tag-adapter.test.ts`
- Modify: `packages/marketplaces/test/scrapers.test.ts`
- Modify: `packages/shared/src/marketplaces.ts` (adiciona `amazonApi` a `TagCredentials`, precisa existir antes do adapter usá-lo)
- Modify: `packages/marketplaces/src/index.ts`

**Interfaces:**
- Consumes: `extractAsin`, `getItems`, `mapCreatorsApiItem`, `type AmazonApiItem` (Task 2)
- Produces: `TagAdapterOptions.amazonGetItems?: (asins: string[], creds: AmazonApiCredentials) => Promise<AmazonApiItem[]>` (permite mockar em teste)

- [ ] **Step 1: Adiciona o campo `amazonApi` em `TagCredentials`**

Em `packages/shared/src/marketplaces.ts`, dentro da interface `TagCredentials`, depois de `magaluSession?: SessionCookies;`:

```ts
  /** Credenciais da Creators API (Client ID/Secret) — usadas para buscar dados de produto via GetItems. */
  amazonApi?: { clientId: string; clientSecret: string };
```

- [ ] **Step 2: Write the failing tests**

Substitua o teste `'amazon converte e valida conexão'` em `packages/marketplaces/test/tag-adapter.test.ts` por:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTagAdapter, UnsupportedError, getAdapter } from '../src/index';
import type { AmazonApiItem } from '../src/amazon/creators-api';

describe('tag adapters', () => {
  it('amazon busca produtos via Creators API (GetItems) usando tag como partnerTag', async () => {
    const amazonGetItems = vi.fn(
      async (): Promise<AmazonApiItem[]> => [
        {
          asin: 'B09B8V1LZ3',
          itemInfo: { title: { displayValue: 'Echo Dot' } },
          offersV2: { listings: [{ price: { money: { amount: 299 } } }] },
        },
      ],
    );
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };

    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/dp/B09B8V1LZ3']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'Echo Dot', price: 299, externalId: 'B09B8V1LZ3' });
    expect(amazonGetItems).toHaveBeenCalledWith(
      ['B09B8V1LZ3'],
      { clientId: 'cid', clientSecret: 'csecret', partnerTag: 'minha-20' },
    );
  });

  it('amazon: URL sem ASIN reconhecível é ignorada (sem crash)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => []);
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };
    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/busca?q=teste']);
    expect(result).toEqual([]);
    expect(amazonGetItems).not.toHaveBeenCalled();
  });

  it('amazon: sem amazonApi configurado, fetchByUrls devolve lista vazia (sem chamar a API)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => []);
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const result = await a.fetchByUrls(
      { tag: 'minha-20' },
      ['https://www.amazon.com.br/dp/B09B8V1LZ3'],
    );
    expect(result).toEqual([]);
    expect(amazonGetItems).not.toHaveBeenCalled();
  });

  it('amazon: erro na API não lança — devolve lista vazia (sem fallback)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => {
      throw new Error('boom');
    });
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };
    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/dp/B09B8V1LZ3']);
    expect(result).toEqual([]);
  });

  it('amazon: checkConnection só com tag continua ok (comportamento local-only preservado)', async () => {
    const a = createTagAdapter('AMAZON');
    expect(await a.checkConnection({ tag: 'minha-20' })).toEqual({ ok: true });
    expect((await a.checkConnection({})).ok).toBe(false);
  });

  it('amazon: toAffiliateLink por tag continua funcionando (fora de escopo desta fase)', async () => {
    const a = createTagAdapter('AMAZON');
    expect(
      await a.toAffiliateLink({ tag: 'minha-20' }, 'https://www.amazon.com.br/dp/B0ABCDEF12'),
    ).toBe('https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20');
  });

  it('mercado livre exige matt_word e matt_tool', async () => {
    const a = createTagAdapter('MERCADOLIVRE');
    expect((await a.checkConnection({ mattWord: 'x' })).ok).toBe(false);
    expect((await a.checkConnection({ mattWord: 'x', mattTool: '1' })).ok).toBe(true);
  });
  it('search não suportado em tag adapter, fetchByUrls é suportado', async () => {
    const a = createTagAdapter('MAGALU');
    expect(a.search).toBeUndefined();
    expect(typeof a.fetchByUrls).toBe('function');
  });
  it('registry devolve o adapter certo e cacheia', () => {
    expect(getAdapter('AMAZON').kind).toBe('AMAZON');
    expect(getAdapter('AMAZON')).toBe(getAdapter('AMAZON'));
    expect(getAdapter('SHOPEE').kind).toBe('SHOPEE');
  });
});
```

Em `packages/marketplaces/test/scrapers.test.ts`: remova o `it('Amazon: extrai título, preço, preço original, desconto, imagens e frete Prime', ...)` inteiro (linhas 89–126) e remova `parseAmazonHtml` do import no topo do arquivo (fica `import { parseMagaluHtml, parseMercadoLivreHtml } from '../src';`).

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd packages/marketplaces && npx vitest run test/tag-adapter.test.ts test/scrapers.test.ts
```
Expected: FAIL — `createTagAdapter('AMAZON', { amazonGetItems })` option doesn't exist yet; `fetchByUrls` still scrapes.

- [ ] **Step 4: Implement**

Delete `packages/marketplaces/src/scrapers/amazon.ts`.

Em `packages/marketplaces/src/scrapers/index.ts`, remova a linha `export * from './amazon';`:

```ts
export * from './fetcher';
export * from './mercadolivre';
export * from './magalu';
export * from './discovery';
```

Em `packages/marketplaces/src/tag-adapter.ts`, troque os imports do topo:

```ts
import { buildAffiliateUrl } from '@afilados/core';
import {
  hasTagCredentials,
  requiredTagFields,
  type ProductData,
  type TagCredentials,
} from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';
import { scrapeMagalu, scrapeMercadoLivre } from './scrapers';
import { generateOfficialMlLink } from './mercadolivre/official-link';
import { generateOfficialAmazonLink } from './amazon/official-link';
import {
  extractAsin,
  getItems,
  mapCreatorsApiItem,
  type AmazonApiCredentials,
  type AmazonApiItem,
} from './amazon/creators-api';
```

Adicione o campo em `TagAdapterOptions` (depois de `onOfficialLinkError`):

```ts
  /** Chamador do GetItems da Creators API (injetável em testes). */
  amazonGetItems?: (asins: string[], creds: AmazonApiCredentials) => Promise<AmazonApiItem[]>;
```

No topo de `createTagAdapter`, junto das outras resoluções de opções (depois de `amazonOfficialLink`):

```ts
  const amazonGetItems = opts.amazonGetItems ?? getItems;
```

Adicione esta função no módulo (fora de `createTagAdapter`, antes dele):

```ts
async function fetchAmazonByUrls(
  creds: TagCredentials,
  urls: string[],
  amazonGetItems: (asins: string[], creds: AmazonApiCredentials) => Promise<AmazonApiItem[]>,
): Promise<ProductData[]> {
  const partnerTag = creds.tag;
  const clientId = creds.amazonApi?.clientId;
  const clientSecret = creds.amazonApi?.clientSecret;
  if (!partnerTag || !clientId || !clientSecret) return [];

  const urlByAsin = new Map<string, string>();
  for (const url of urls) {
    const asin = extractAsin(url);
    if (asin) urlByAsin.set(asin, url);
  }
  const asins = [...urlByAsin.keys()];
  if (asins.length === 0) return [];

  let items: AmazonApiItem[];
  try {
    items = await amazonGetItems(asins, { clientId, clientSecret, partnerTag });
  } catch {
    // Sem fallback para scraping (decisão de design): a chamada falhou, nenhum produto Amazon
    // deste lote é retornado — quem chamou trata a lista vazia como "nada encontrado".
    return [];
  }

  const results: ProductData[] = [];
  for (const item of items) {
    const url = urlByAsin.get(item.asin);
    if (url) results.push(mapCreatorsApiItem(item, url));
  }
  return results;
}
```

Substitua o corpo de `fetchByUrls` dentro de `createTagAdapter`:

```ts
    async fetchByUrls(creds, urls: string[]): Promise<ProductData[]> {
      if (kind === 'AMAZON') {
        return fetchAmazonByUrls(creds, urls, amazonGetItems);
      }
      const results: ProductData[] = [];
      for (const url of urls) {
        try {
          const product =
            kind === 'MERCADOLIVRE' ? await scrapeMercadoLivre(url) : await scrapeMagalu(url);
          results.push(product);
        } catch {
          // Se falhar em uma URL, continua para as próximas
        }
      }
      return results;
    },
```

Em `packages/marketplaces/src/index.ts`, adicione a exportação do novo módulo (depois da linha do `amazon/official-link`):

```ts
export {
  AmazonApiError,
  getAccessToken,
  getItems,
  extractAsin,
  mapCreatorsApiItem,
  type AmazonApiCredentials,
  type AmazonApiItem,
  type AmazonApiOptions,
} from './amazon/creators-api';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/marketplaces && npx vitest run
```
Expected: PASS — inclui os testes atualizados de `tag-adapter.test.ts` e `scrapers.test.ts` (sem o caso Amazon), e os de `amazon-creators-api.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/marketplaces.ts packages/marketplaces/src/tag-adapter.ts packages/marketplaces/src/scrapers/index.ts packages/marketplaces/src/index.ts packages/marketplaces/test/tag-adapter.test.ts packages/marketplaces/test/scrapers.test.ts
git rm packages/marketplaces/src/scrapers/amazon.ts
git commit -m "feat(marketplaces): fetchByUrls da Amazon usa GetItems, remove scraper de HTML"
```

---

## Task 4: checkConnection da Amazon valida as credenciais reais da API

**Files:**
- Modify: `packages/marketplaces/src/tag-adapter.ts`
- Modify: `packages/marketplaces/test/tag-adapter.test.ts`

**Interfaces:**
- Consumes: `amazonGetItems` (já resolvido em `createTagAdapter`, Task 3)

- [ ] **Step 1: Write the failing tests**

Adicione em `packages/marketplaces/test/tag-adapter.test.ts` (dentro do `describe('tag adapters', ...)`):

```ts
  it('amazon: checkConnection com amazonApi válido chama GetItems e devolve ok', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => [{ asin: 'B08N5WRWNW' }]);
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };
    expect(await a.checkConnection(creds)).toEqual({ ok: true });
    expect(amazonGetItems).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(String)]),
      { clientId: 'cid', clientSecret: 'csecret', partnerTag: 'minha-20' },
    );
  });

  it('amazon: checkConnection com amazonApi inválido devolve ok:false com a mensagem do erro', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => {
      throw new Error('Credenciais da Creators API inválidas');
    });
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'bad', clientSecret: 'bad' } };
    expect(await a.checkConnection(creds)).toEqual({
      ok: false,
      error: 'Credenciais da Creators API inválidas',
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/marketplaces && npx vitest run test/tag-adapter.test.ts
```
Expected: FAIL — `checkConnection` ainda não usa `amazonGetItems`, então o mock nunca é chamado e o segundo teste não recebe o erro esperado.

- [ ] **Step 3: Implement**

Em `packages/marketplaces/src/tag-adapter.ts`, adicione a constante no topo do módulo (fora de `createTagAdapter`):

```ts
/** ASIN estável só para o teste mínimo de credenciais em checkConnection; o conteúdo não importa. */
const AMAZON_CHECK_CONNECTION_ASIN = 'B08N5WRWNW';
```

No corpo de `checkConnection`, adicione o novo branch **antes** do branch existente `if (kind === 'AMAZON' && creds?.amazonSession?.cookies) { ... }`:

```ts
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (kind === 'AMAZON' && creds?.amazonApi?.clientId && creds?.amazonApi?.clientSecret) {
        try {
          await amazonGetItems([AMAZON_CHECK_CONNECTION_ASIN], {
            clientId: creds.amazonApi.clientId,
            clientSecret: creds.amazonApi.clientSecret,
            partnerTag: creds.tag ?? '',
          });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (kind === 'AMAZON' && creds?.amazonSession?.cookies) {
        // ... resto do método permanece igual ...
```

(o restante do método — o branch de `amazonSession`, `hasTagCredentials`, etc. — não muda.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/marketplaces && npx vitest run test/tag-adapter.test.ts
```
Expected: PASS (todos os testes de `tag-adapter.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/marketplaces/src/tag-adapter.ts packages/marketplaces/test/tag-adapter.test.ts
git commit -m "feat(marketplaces): checkConnection da Amazon valida credenciais via GetItems"
```

---

## Task 5: Credenciais da Creators API na API (schema, persistência, exposição)

**Files:**
- Modify: `packages/shared/src/api.ts`
- Modify: `apps/api/src/lib/marketplaces.ts`
- Modify: `apps/api/src/routes/marketplaces.ts`
- Modify: `apps/api/test/marketplaces.test.ts`

**Interfaces:**
- Consumes: `TagCredentials.amazonApi` (Task 3)
- Produces: `marketplaceUpdateSchema` com `amazonClientId?: string`, `amazonClientSecret?: string`
- Produces: `publicConnection(...)` com `amazonClientId: string | null`, `hasAmazonApiSecret: boolean`

- [ ] **Step 1: Write the failing tests**

Adicione em `apps/api/test/marketplaces.test.ts`, dentro do `describe('marketplaces', ...)`, depois do teste `'amazon: salva tag e testa conexão'`:

```ts
  it('amazon: salva Client ID/Secret da Creators API, nunca devolve o secret, e check valida via API', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'api-20', amazonClientId: 'cid-1', amazonClientSecret: 's3gredo' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      kind: 'AMAZON',
      affiliateTag: 'api-20',
      amazonClientId: 'cid-1',
      hasAmazonApiSecret: true,
    });
    expect(JSON.stringify(put.json())).not.toContain('s3gredo');

    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonApi?: { clientId: string; clientSecret: string } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonApi).toEqual({ clientId: 'cid-1', clientSecret: 's3gredo' });
  });

  it('amazon: PUT parcial sem os dois campos da API preserva amazonApi já salvo', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { amazonClientId: 'cid-2', amazonClientSecret: 's3gredo2' },
    });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'outra-tag-20' },
    });
    expect(put.json()).toMatchObject({ hasAmazonApiSecret: true, amazonClientId: 'cid-2' });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonApi?: { clientId: string; clientSecret: string } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonApi).toEqual({ clientId: 'cid-2', clientSecret: 's3gredo2' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/api && npx vitest run test/marketplaces.test.ts
```
Expected: FAIL — `amazonClientId`/`amazonClientSecret` não existem em `marketplaceUpdateSchema` (o Zod parse ignora campos desconhecidos, então o PUT nem chega a persistir nada além da tag; `hasAmazonApiSecret`/`amazonClientId` não existem na resposta).

- [ ] **Step 3: Implement**

Em `packages/shared/src/api.ts`, no `marketplaceUpdateSchema`, adicione:

```ts
export const marketplaceUpdateSchema = z.object({
  appId: z.string().min(1).optional(),
  secret: z.string().min(1).optional(),
  affiliateTag: z.string().max(100).optional(),
  mattWord: z.string().min(1).max(60).optional(),
  mattTool: z
    .string()
    .regex(/^\d{1,12}$/, 'matt_tool deve ser numérico')
    .optional(),
  amazonClientId: z.string().min(1).optional(),
  amazonClientSecret: z.string().min(1).optional(),
});
```

Em `apps/api/src/lib/marketplaces.ts`, adicione os dois campos em `publicConnection` (depois de `mattTool`):

```ts
    mattWord: creds?.mattWord ?? null,
    mattTool: creds?.mattTool ?? null,
    amazonClientId: creds?.amazonApi?.clientId ?? null,
    hasAmazonApiSecret: Boolean(creds?.amazonApi?.clientSecret),
```

E em `loadTagCredentials`, depois do bloco de `missing`/`hasMlSession`:

```ts
  if (kind === 'AMAZON' && (!creds.amazonApi?.clientId || !creds.amazonApi?.clientSecret)) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'AMAZON: configure Client ID/Secret da Creators API em Configurações',
      400,
    );
  }
```

Em `apps/api/src/routes/marketplaces.ts`, no handler `PUT /marketplaces/:kind`, troque o branch `else` (AMAZON/MAGALU) do `mutate`:

```ts
            : {
                tag: body.affiliateTag ?? prev.tag,
                // sessão manual (Amazon/Magalu) não é editável aqui; só preservada
                ...(prev.amazonSession ? { amazonSession: prev.amazonSession } : {}),
                ...(prev.magaluSession ? { magaluSession: prev.magaluSession } : {}),
                // Client ID/Secret da Creators API só são substituídos quando os dois vêm
                // juntos no body; caso contrário preserva o que já estava salvo (ou undefined).
                ...(kind === 'AMAZON'
                  ? {
                      amazonApi:
                        body.amazonClientId && body.amazonClientSecret
                          ? { clientId: body.amazonClientId, clientSecret: body.amazonClientSecret }
                          : prev.amazonApi,
                    }
                  : {}),
              },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/api && npx vitest run test/marketplaces.test.ts
```
Expected: PASS (todos os testes, incluindo os dois novos).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts apps/api/src/lib/marketplaces.ts apps/api/src/routes/marketplaces.ts apps/api/test/marketplaces.test.ts
git commit -m "feat(api): persiste e expõe Client ID/Secret da Creators API da Amazon"
```

---

## Task 6: Tela de configuração da Amazon (web)

**Files:**
- Modify: `apps/web/src/components/marketplaces/marketplace-config.ts`
- Modify: `apps/web/src/components/marketplaces/marketplace-drawer.tsx`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/test/marketplace-drawer.test.tsx`

**Interfaces:**
- Consumes: `MarketplaceConnection.amazonClientId`, `MarketplaceConnection.hasAmazonApiSecret` (Task 5, mesmos nomes que `publicConnection` devolve)
- Produces: `MarketplaceFieldKey` inclui `'amazonClientId' | 'amazonClientSecret'`

- [ ] **Step 1: Write the failing tests**

Em `apps/web/test/marketplace-drawer.test.tsx`, adicione os dois campos novos em `baseConnection`:

```ts
const baseConnection: MarketplaceConnection = {
  kind: 'AMAZON',
  status: 'UNCONFIGURED',
  affiliateTag: null,
  appId: null,
  hasSecret: false,
  mattWord: null,
  mattTool: null,
  amazonClientId: null,
  hasAmazonApiSecret: false,
  mlSessionSyncedAt: null,
  mlSessionSource: null,
  amazonSessionSyncedAt: null,
  amazonSessionSource: null,
  magaluSessionSyncedAt: null,
  magaluSessionSource: null,
  lastCheckedAt: null,
  lastError: null,
};
```

E adicione, dentro de `describe('MarketplaceDrawer', ...)`:

```ts
  it('envia amazonClientId/amazonClientSecret quando preenchidos', async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={baseConnection}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
        feedback={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'cid-1' } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: 'sec-1' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fields: { amazonClientId: 'cid-1', amazonClientSecret: 'sec-1' },
      cookie: '',
    });
  });

  it('mostra "já salvo" no placeholder do Client Secret da Amazon quando hasAmazonApiSecret é true', () => {
    render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={{ ...baseConnection, hasAmazonApiSecret: true }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.getByLabelText(/client secret/i)).toHaveAttribute('placeholder', '•••• (já salvo)');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/web && npx vitest run test/marketplace-drawer.test.tsx
```
Expected: FAIL — TypeScript error (faltam `amazonClientId`/`hasAmazonApiSecret` no tipo `MarketplaceConnection`) e/ou `getByLabelText(/client id/i)` não encontra nada porque o campo não existe na config da Amazon.

- [ ] **Step 3: Implement**

Em `apps/web/src/lib/types.ts`, no `MarketplaceConnection`, adicione (depois de `mattTool`):

```ts
  amazonClientId: string | null;
  hasAmazonApiSecret: boolean;
```

Em `apps/web/src/components/marketplaces/marketplace-config.ts`:

```ts
export type MarketplaceFieldKey =
  | 'appId'
  | 'secret'
  | 'affiliateTag'
  | 'mattWord'
  | 'mattTool'
  | 'amazonClientId'
  | 'amazonClientSecret';
```

E no `MARKETPLACE_CONFIGS.AMAZON.fields`, adicione os dois campos novos depois de `affiliateTag`:

```ts
  AMAZON: {
    kind: 'AMAZON',
    label: 'Amazon BR',
    description: 'Tag de afiliado e credenciais da Creators API (dados de produto).',
    platformUrl: 'https://afiliados.amazon.com.br/',
    fields: [
      {
        key: 'affiliateTag',
        label: 'Tag de Associado Amazon',
        type: 'text',
        required: true,
        placeholder: 'Ex: seunome-20',
        helpTitle: 'Onde encontrar minha tag?',
        helpContent: 'É a sua Store ID / Tracking ID no Programa de Associados Amazon.',
      },
      {
        key: 'amazonClientId',
        label: 'Client ID (Creators API)',
        type: 'text',
        required: false,
        placeholder: 'Ex: amzn1.application-oa2-client....',
        helpTitle: 'Onde consigo o Client ID?',
        helpContent:
          'Em Associates Central → Ferramentas → Creators API → Register for Creators API. Exige pelo menos 10 vendas qualificadas nos últimos 30 dias.',
      },
      {
        key: 'amazonClientSecret',
        label: 'Client Secret (Creators API)',
        type: 'password',
        required: false,
        helpTitle: 'Onde consigo o Client Secret?',
        helpContent: 'Gerado junto com o Client ID no mesmo cadastro da Creators API.',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'session-id',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Cookie de sessão do SiteStripe (opcional; usado em uma etapa futura para gerar links curtos amzn.to). Com a sessão logada em amazon.com.br, copie o valor do cookie "session-id".',
  },
```

Em `apps/web/src/components/marketplaces/marketplace-drawer.tsx`, no `initialFieldValue`, adicione os dois casos novos:

```ts
function initialFieldValue(key: MarketplaceFieldKey, connection?: MarketplaceConnection): string {
  switch (key) {
    case 'appId':
      return connection?.appId ?? '';
    case 'affiliateTag':
      return connection?.affiliateTag ?? '';
    case 'mattWord':
      return connection?.mattWord ?? '';
    case 'mattTool':
      return connection?.mattTool ?? '';
    case 'amazonClientId':
      return connection?.amazonClientId ?? '';
    case 'secret':
    case 'amazonClientSecret':
      return '';
  }
}
```

E no `placeholder` do `<Input>` dentro do `.map((field) => ...)`:

```tsx
                placeholder={
                  field.key === 'secret'
                    ? connection?.hasSecret
                      ? '•••• (já salvo)'
                      : ''
                    : field.key === 'amazonClientSecret'
                      ? connection?.hasAmazonApiSecret
                        ? '•••• (já salvo)'
                        : ''
                      : field.placeholder
                }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/web && npx vitest run test/marketplace-drawer.test.tsx
```
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/marketplaces/marketplace-config.ts apps/web/src/components/marketplaces/marketplace-drawer.tsx apps/web/src/lib/types.ts apps/web/test/marketplace-drawer.test.tsx
git commit -m "feat(web): tela de config da Amazon ganha Client ID/Secret da Creators API"
```

---

## Task 7: Carregar credenciais reais da Amazon em todos os chamadores de fetchByUrls

**Context for the implementer:** Every current caller of `getTagAdapter('AMAZON'|'MERCADOLIVRE'|'MAGALU').fetchByUrls(...)` passes an empty `{}` as credentials, because the old HTML scraper didn't need any. Now that `AMAZON` calls the Creators API, it needs `tag` + `amazonApi.clientId/clientSecret` — passing `{}` makes `fetchByUrls` silently return `[]` for every Amazon URL (see Task 3's `fetchAmazonByUrls`, which returns `[]` early when credentials are missing). This task fixes every one of those call sites for `AMAZON` specifically, leaving `MERCADOLIVRE`/`MAGALU` untouched (they still scrape and don't need credentials).

**Files:**
- Create: `apps/worker/src/lib/marketplace-credentials.ts`
- Test: `apps/worker/test/marketplace-credentials.test.ts`
- Modify: `apps/worker/src/processors/product-enrich.ts`
- Modify: `apps/worker/src/automation/discovery.ts`
- Modify: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/routes/extension.ts`

**Interfaces:**
- Consumes: `loadTagCredentials(db, kind)` from `apps/api/src/lib/marketplaces.ts` (already exists, Task 5 extended it) — used in the two `apps/api` files.
- Produces: `export async function loadTagCredentials(tenantId: string, kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU'): Promise<TagCredentials>` in `apps/worker/src/lib/marketplace-credentials.ts` — used in the two `apps/worker` files. (Same name, different module/signature — the worker has no Fastify `TenantClient`, so it takes a plain `tenantId` and queries Prisma directly.)

- [ ] **Step 1: Write the failing test (worker helper)**

Create `apps/worker/test/marketplace-credentials.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { loadTagCredentials } from '../src/lib/marketplace-credentials';

describe('loadTagCredentials (worker)', () => {
  let tenantId: string;

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant Creds' } });
    tenantId = tenant.id;
  });

  it('devolve {} quando não há conexão configurada', async () => {
    const creds = await loadTagCredentials(tenantId, 'AMAZON');
    expect(creds).toEqual({});
  });

  it('decripta e devolve as credenciais salvas', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId,
        kind: 'AMAZON',
        encryptedCredentials: encryptJson({
          tag: 'minha-20',
          amazonApi: { clientId: 'cid', clientSecret: 'csecret' },
        }),
      },
    });
    const creds = await loadTagCredentials(tenantId, 'AMAZON');
    expect(creds).toEqual({ tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/worker && npx vitest run test/marketplace-credentials.test.ts
```
Expected: FAIL — `Cannot find module '../src/lib/marketplace-credentials'`.

- [ ] **Step 3: Implement the worker helper**

Create `apps/worker/src/lib/marketplace-credentials.ts`:

```ts
import { prisma, decryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';

/**
 * Carrega e decripta as credenciais de um marketplace por tag (ML/Amazon/Magalu) do tenant.
 * Só é preciso de verdade para a Amazon (Creators API) — Mercado Livre e Magalu continuam
 * raspando HTML por URL e não usam nada daqui, mas a função aceita os três por uniformidade.
 */
export async function loadTagCredentials(
  tenantId: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Promise<TagCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
  if (!row?.encryptedCredentials) return {};
  return decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/worker && npx vitest run test/marketplace-credentials.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the helper into the two worker call sites**

In `apps/worker/src/processors/product-enrich.ts`, add the import (near the top, with the other local imports):

```ts
import { loadTagCredentials } from '../lib/marketplace-credentials';
```

Replace `fetchViaAdapter`'s last line:

```ts
async function fetchViaAdapter(
  tenantId: string,
  kind: ProductEnrichJob['marketplaceKind'],
  url: string,
): Promise<ProductData | null> {
  if (kind === 'SHOPEE') {
    const conn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'SHOPEE' },
    });
    if (!conn?.encryptedCredentials) throw new Error('Shopee não configurada para este tenant');
    const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
    const list = await createShopeeAdapter().fetchByUrls(creds, [url]);
    return list[0] ?? null;
  }
  const creds = kind === 'AMAZON' ? await loadTagCredentials(tenantId, kind) : {};
  const list = await getTagAdapter(kind).fetchByUrls(creds, [url]);
  return list[0] ?? null;
}
```

In `apps/worker/src/automation/discovery.ts`, add the import (with the other local imports):

```ts
import { loadTagCredentials } from '../lib/marketplace-credentials';
```

Replace the `fetchFn` line inside `discoverScraped`:

```ts
  const fetchFn =
    deps.fetchByUrls?.[marketplace] ??
    (async (u: string[]) => {
      const creds = marketplace === 'AMAZON' ? await loadTagCredentials(rule.tenantId, marketplace) : {};
      return getTagAdapter(marketplace).fetchByUrls(creds, u);
    });
  return fetchFn(urls);
```

- [ ] **Step 6: Wire the existing api helper into the two api call sites**

In `apps/api/src/routes/products.ts`, add `loadTagCredentials` to the existing import:

```ts
import { getShopeeAdapter, getTagAdapter, loadShopeeCredentials, loadTagCredentials } from '../lib/marketplaces';
```

Replace the line in `/products/search` (inside `app.post('/products/search', ...)`, after `if (urls.length === 0) return { products: [] };`):

```ts
    if (urls.length === 0) return { products: [] };
    const amazonCreds = kind === 'AMAZON' ? await loadTagCredentials(req.db, kind) : {};
    const found = await getTagAdapter(kind).fetchByUrls(amazonCreds, urls.slice(0, q.limit));
```

Replace the line in `/products/import`'s `scrapeInline` branch:

```ts
        } else if (scrapeInline) {
          const amazonCreds = kind === 'AMAZON' ? await loadTagCredentials(req.db, kind) : {};
          const found = await getTagAdapter(kind).fetchByUrls(amazonCreds, kindUrls);
          allFound.push(...found);
        } else {
```

In `apps/api/src/routes/extension.ts`, add `loadTagCredentials` to the existing import:

```ts
import {
  getShopeeAdapter,
  getTagAdapter,
  loadShopeeCredentials,
  loadTagCredentials,
  upsertMarketplaceCredentials,
} from '../lib/marketplaces';
```

Replace the `else` branch inside `app.post('/extension/capture', ...)`:

```ts
      } else {
        const amazonCreds =
          body.marketplaceKind === 'AMAZON'
            ? await loadTagCredentials(forTenant(tenantId), body.marketplaceKind)
            : {};
        list = await getTagAdapter(body.marketplaceKind).fetchByUrls(amazonCreds, [body.url]);
      }
```

- [ ] **Step 7: Run the full test suites for the four touched files to verify nothing regressed**

```bash
cd apps/worker && npx vitest run test/product-enrich.test.ts test/marketplace-credentials.test.ts
cd apps/api && npx vitest run test/marketplaces.test.ts test/products.test.ts test/extension.test.ts
```
Expected: PASS. (These existing test files don't exercise the real Amazon Creators API path — `MERCADOLIVRE`/`MAGALU`/`SHOPEE` behavior is unchanged, and any Amazon-specific behavior here is already covered by Task 3/4's `tag-adapter` tests.)

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/lib/marketplace-credentials.ts apps/worker/test/marketplace-credentials.test.ts apps/worker/src/processors/product-enrich.ts apps/worker/src/automation/discovery.ts apps/api/src/routes/products.ts apps/api/src/routes/extension.ts
git commit -m "fix: carrega credenciais reais da Amazon nos chamadores de fetchByUrls (necessário p/ Creators API)"
```

---

## Final check

- [ ] Run the whole workspace test suite once, from the repo root, to catch anything the per-package runs above missed:

```bash
pnpm test
```
Expected: all green.
