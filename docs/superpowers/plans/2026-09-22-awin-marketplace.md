# Awin como Marketplace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a Awin como marketplace de origem de produtos: credenciais + import de datafeeds para um cache local (com poda de produtos obsoletos), busca por palavra-chave sobre esse cache (manual e via automação), geração de link de afiliado e todos os pontos de integração existentes (envio, "adicionar por URL", tela de configuração).

**Architecture:** `packages/marketplaces/src/awin/` fica "puro" (HTTP + parsing de CSV, sem banco) — lista/baixa datafeeds e mapeia linhas do CSV. Um processor no worker (`awin-import.ts`) usa esse módulo para popular a tabela `AwinCatalogProduct` (upsert + poda por feed). Busca (manual e automação) e "adicionar por URL" leem esse cache diretamente via Prisma, sem chamar a Awin ao vivo — não existe endpoint de busca em tempo real na Awin. `AwinCredentials` é um tipo próprio (como `ShopeeCredentials`), registrado como terceira ramificação em `packages/marketplaces/src/registry.ts`.

**Tech Stack:** TypeScript, Fastify, Prisma/Postgres, BullMQ/Redis, `csv-parse`, Vitest, Next.js.

## Global Constraints

- Segue o padrão de credenciais criptografadas em `MarketplaceConnection.encryptedCredentials` (mesmo mecanismo de Shopee/Amazon/ML/Magalu).
- `packages/marketplaces` não pode depender de `@afilados/db` (mantém a separação HTTP-puro vs. camada de dados) — cache/busca ficam em `apps/api`/`apps/worker`.
- Falha ao importar um `feedId` não pode interromper os demais (best-effort, mesmo critério do scraping ML/Magalu).
- Toda tabela nova tem `tenantId` e entra em `TENANT_MODELS` (`packages/db/src/index.ts`) para o `forTenant` escopar automaticamente.
- Testes de integração (rotas, worker) usam banco real de teste (padrão já usado em `apps/worker/test/automation-discovery.test.ts` e `apps/api/test/marketplaces.test.ts`), não mocks de Prisma.

---

### Task 1: Tipos compartilhados, schema do banco e filas

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/api.ts` (`marketplaceUpdateSchema`)
- Modify: `packages/shared/src/queues.ts`
- Create: `packages/shared/src/awin.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts` (`TENANT_MODELS`)
- Test: `packages/shared/test/awin.test.ts`

**Interfaces:**
- Produces: `MARKETPLACE_KINDS` inclui `'AWIN'`; `QUEUE_AWIN_IMPORT: string`; `interface AwinImportJob { tenantId: string }`; `interface AwinCatalogRow { externalId: string; title: string; price: number; originalPrice: number | null; imageUrl: string | null; deepLink: string; raw: unknown }`; `function mapAwinCatalogRowToProductData(row: AwinCatalogRow): ProductData` (source sempre `'AWIN'`); modelo Prisma `AwinCatalogProduct` com `@@unique([tenantId, feedId, externalId])`.

- [ ] **Step 1: Escrever o teste do mapper puro**

```ts
// packages/shared/test/awin.test.ts
import { describe, it, expect } from 'vitest';
import { mapAwinCatalogRowToProductData } from '../src/awin';

describe('mapAwinCatalogRowToProductData', () => {
  it('mapeia uma linha do cache para ProductData com source AWIN', () => {
    const result = mapAwinCatalogRowToProductData({
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
      raw: { foo: 'bar' },
    });
    expect(result).toEqual({
      source: 'AWIN',
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      images: ['https://x/img.png'],
      shipping: 'UNKNOWN',
      originalUrl: 'https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
      raw: { foo: 'bar' },
    });
  });

  it('omite originalPrice e images quando ausentes', () => {
    const result = mapAwinCatalogRowToProductData({
      externalId: 'p2',
      title: 'Caneca',
      price: 20,
      originalPrice: null,
      imageUrl: null,
      deepLink: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      raw: {},
    });
    expect(result.originalPrice).toBeUndefined();
    expect(result.images).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/shared test -- awin.test.ts`
Expected: FAIL — `Cannot find module '../src/awin'`

- [ ] **Step 3: Adicionar `AWIN` aos enums**

```ts
// packages/shared/src/enums.ts (linha 1)
export const MARKETPLACE_KINDS = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU', 'AWIN'] as const;
```

- [ ] **Step 4: Criar `packages/shared/src/awin.ts`**

```ts
// packages/shared/src/awin.ts
import type { ProductData } from './product';

export interface AwinCatalogRow {
  externalId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  deepLink: string;
  raw: unknown;
}

export function mapAwinCatalogRowToProductData(row: AwinCatalogRow): ProductData {
  return {
    source: 'AWIN',
    externalId: row.externalId,
    title: row.title,
    price: row.price,
    ...(row.originalPrice !== null ? { originalPrice: row.originalPrice } : {}),
    images: row.imageUrl ? [row.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: row.deepLink,
    raw: row.raw,
  };
}
```

- [ ] **Step 5: Exportar o novo módulo**

```ts
// packages/shared/src/index.ts — adiciona ao final
export * from './awin';
```

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/shared test -- awin.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 7: Adicionar campos da Awin ao `marketplaceUpdateSchema`**

```ts
// packages/shared/src/api.ts — dentro de marketplaceUpdateSchema, após amazonClientSecret
  publisherId: z.string().min(1).max(40).optional(),
  datafeedApiKey: z.string().min(1).max(200).optional(),
  feedIds: z.array(z.string().min(1).max(40)).max(50).optional(),
```

- [ ] **Step 8: Adicionar a fila e o job de import**

```ts
// packages/shared/src/queues.ts — adiciona ao final das constantes de fila
export const QUEUE_AWIN_IMPORT = 'awin-import';

// adiciona junto às demais interfaces de job
export interface AwinImportJob {
  tenantId: string;
}
```

- [ ] **Step 9: Adicionar `AWIN` ao enum Prisma e o modelo `AwinCatalogProduct`**

```prisma
// packages/db/prisma/schema.prisma — enum MarketplaceKind
enum MarketplaceKind {
  SHOPEE
  MERCADOLIVRE
  AMAZON
  MAGALU
  AWIN
}
```

```prisma
// packages/db/prisma/schema.prisma — novo modelo, após o modelo Product
model AwinCatalogProduct {
  id             String   @id @default(cuid())
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  feedId         String
  advertiserId   String?
  advertiserName String?
  externalId     String
  title          String
  price          Decimal  @db.Decimal(12, 2)
  originalPrice  Decimal? @db.Decimal(12, 2)
  imageUrl       String?
  deepLink       String
  raw            Json
  lastImportedAt DateTime @default(now())

  @@unique([tenantId, feedId, externalId])
  @@index([tenantId, title])
}
```

```prisma
// packages/db/prisma/schema.prisma — model Tenant, adiciona a relação junto às demais
  awinCatalogProducts AwinCatalogProduct[]
```

- [ ] **Step 10: Adicionar o modelo aos `TENANT_MODELS`**

```ts
// packages/db/src/index.ts — dentro do Set TENANT_MODELS, após 'TelegramChat'
  'AwinCatalogProduct',
```

- [ ] **Step 11: Gerar e rodar a migration**

Run: `pnpm db:migrate -- --name awin_catalog`
Expected: cria `packages/db/prisma/migrations/<timestamp>_awin_catalog/migration.sql` e aplica no banco de dev sem erro.

Run: `pnpm db:generate`
Expected: Prisma Client regenerado com `prisma.awinCatalogProduct`.

- [ ] **Step 12: Rodar a suíte de shared inteira para garantir que nada quebrou**

Run: `pnpm --filter @afilados/shared test`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add packages/shared packages/db
git commit -m "feat(shared,db): tipos, fila e schema da Awin (AwinCatalogProduct)"
```

---

### Task 2: `packages/marketplaces` — cliente de datafeed (list + download)

**Files:**
- Create: `packages/marketplaces/src/awin/datafeed.ts`
- Test: `packages/marketplaces/test/awin-datafeed.test.ts`

**Interfaces:**
- Consumes: nenhuma (módulo raiz, só `csv-parse/sync`).
- Produces: `class AwinApiError extends Error { code: 'AWIN_UNAUTHORIZED' | 'AWIN_ERROR' }`; `interface AwinFeedListEntry { advertiserId: string; advertiserName: string; feedId: string; feedName: string; url: string }`; `interface AwinFeedRow { [key: string]: string | undefined }`; `interface AwinDatafeedOptions { fetchImpl?: typeof fetch; listBaseUrl?: string }`; `function listDatafeeds(datafeedApiKey: string, opts?: AwinDatafeedOptions): Promise<AwinFeedListEntry[]>`; `function downloadFeed(feedUrl: string, opts?: AwinDatafeedOptions): Promise<AwinFeedRow[]>`.

- [ ] **Step 1: Escrever os testes**

```ts
// packages/marketplaces/test/awin-datafeed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { listDatafeeds, downloadFeed, AwinApiError } from '../src/awin/datafeed';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  })) as unknown as typeof fetch;
}

describe('listDatafeeds', () => {
  it('parseia o CSV de listagem em AwinFeedListEntry[]', async () => {
    const csv =
      'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL\n' +
      '111,Loja X,BR,joined,222,Feed Principal,pt,,2026-09-01,https://productdata.awin.com/download/222\n';
    const fetchImpl = fetchReturningText(200, csv);
    const result = await listDatafeeds('key123', { fetchImpl, listBaseUrl: 'https://productdata.awin.com/datafeed/list/apikey' });
    expect(fetchImpl).toHaveBeenCalledWith('https://productdata.awin.com/datafeed/list/apikey/key123');
    expect(result).toEqual([
      {
        advertiserId: '111',
        advertiserName: 'Loja X',
        feedId: '222',
        feedName: 'Feed Principal',
        url: 'https://productdata.awin.com/download/222',
      },
    ]);
  });

  it('lança AWIN_UNAUTHORIZED em 401', async () => {
    const fetchImpl = fetchReturningText(401, '');
    await expect(listDatafeeds('badkey', { fetchImpl })).rejects.toMatchObject({
      code: 'AWIN_UNAUTHORIZED',
    });
  });
});

describe('downloadFeed', () => {
  it('parseia o CSV do catálogo em linhas de objeto', async () => {
    const csv = 'aw_product_id,product_name,search_price\np1,Produto 1,10.50\n';
    const fetchImpl = fetchReturningText(200, csv);
    const rows = await downloadFeed('https://productdata.awin.com/download/222', { fetchImpl });
    expect(rows).toEqual([{ aw_product_id: 'p1', product_name: 'Produto 1', search_price: '10.50' }]);
  });

  it('lança AwinApiError em resposta não-2xx', async () => {
    const fetchImpl = fetchReturningText(500, '');
    await expect(downloadFeed('https://x', { fetchImpl })).rejects.toBeInstanceOf(AwinApiError);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/marketplaces test -- awin-datafeed.test.ts`
Expected: FAIL — `Cannot find module '../src/awin/datafeed'`

- [ ] **Step 3: Implementar `packages/marketplaces/src/awin/datafeed.ts`**

```ts
import { parse } from 'csv-parse/sync';

const DATAFEED_LIST_BASE_DEFAULT =
  process.env.AWIN_DATAFEED_LIST_URL ?? 'https://productdata.awin.com/datafeed/list/apikey';

export class AwinApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'AWIN_UNAUTHORIZED' | 'AWIN_ERROR',
  ) {
    super(message);
    this.name = 'AwinApiError';
  }
}

export interface AwinFeedListEntry {
  advertiserId: string;
  advertiserName: string;
  feedId: string;
  feedName: string;
  url: string;
}

export interface AwinFeedRow {
  [key: string]: string | undefined;
}

export interface AwinDatafeedOptions {
  fetchImpl?: typeof fetch;
  listBaseUrl?: string;
}

export async function listDatafeeds(
  datafeedApiKey: string,
  opts: AwinDatafeedOptions = {},
): Promise<AwinFeedListEntry[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.listBaseUrl ?? DATAFEED_LIST_BASE_DEFAULT;
  const res = await doFetch(`${base}/${datafeedApiKey}`);
  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError('Datafeed API key inválida', 'AWIN_UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new AwinApiError(`Listagem de feeds da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const text = await res.text();
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<
    string,
    string
  >[];
  return rows.map((r) => ({
    advertiserId: r['Advertiser ID'] ?? '',
    advertiserName: r['Advertiser Name'] ?? '',
    feedId: r['Feed ID'] ?? '',
    feedName: r['Feed Name'] ?? '',
    url: r['URL'] ?? '',
  }));
}

export async function downloadFeed(
  feedUrl: string,
  opts: AwinDatafeedOptions = {},
): Promise<AwinFeedRow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(feedUrl);
  if (!res.ok) {
    throw new AwinApiError(`Download do feed da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as AwinFeedRow[];
}
```

- [ ] **Step 4: Adicionar `csv-parse` como dependência direta do pacote (hoje é transitiva)**

Run: `pnpm --filter @afilados/marketplaces add csv-parse`
Expected: `packages/marketplaces/package.json` ganha `csv-parse` em `dependencies`.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/marketplaces test -- awin-datafeed.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 6: Commit**

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): cliente de datafeed da Awin (listagem e download)"
```

---

### Task 3: `packages/marketplaces` — mapper de linha do feed

**Files:**
- Create: `packages/marketplaces/src/awin/mapper.ts`
- Test: `packages/marketplaces/test/awin-mapper.test.ts`

**Interfaces:**
- Consumes: `AwinFeedRow`, `AwinFeedListEntry` (Task 2).
- Produces: `interface AwinCatalogUpsertInput { feedId: string; advertiserId: string | null; advertiserName: string | null; externalId: string; title: string; price: number; originalPrice: number | null; imageUrl: string | null; deepLink: string; raw: AwinFeedRow }`; `function mapAwinRow(row: AwinFeedRow, feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName'>): AwinCatalogUpsertInput | null`.

- [ ] **Step 1: Escrever os testes**

```ts
// packages/marketplaces/test/awin-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapAwinRow } from '../src/awin/mapper';

const feed = { feedId: 'f1', advertiserId: '111', advertiserName: 'Loja X' };

describe('mapAwinRow', () => {
  it('mapeia uma linha completa do CSV', () => {
    const row = {
      aw_product_id: 'p1',
      aw_deep_link: 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=x',
      product_name: 'Fone Bluetooth',
      search_price: '99.90',
      rrp_price: '129.90',
      merchant_image_url: 'https://x/img.png',
    };
    expect(mapAwinRow(row, feed)).toEqual({
      feedId: 'f1',
      advertiserId: '111',
      advertiserName: 'Loja X',
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=x',
      raw: row,
    });
  });

  it('ignora rrp_price quando não é maior que o preço atual', () => {
    const row = {
      aw_product_id: 'p2',
      aw_deep_link: 'https://www.awin1.com/cread.php?x',
      product_name: 'Caneca',
      search_price: '20.00',
      rrp_price: '15.00',
    };
    expect(mapAwinRow(row, feed)?.originalPrice).toBeNull();
  });

  it('retorna null quando falta um campo obrigatório', () => {
    expect(mapAwinRow({ aw_product_id: 'p3' }, feed)).toBeNull();
    expect(mapAwinRow({ aw_product_id: 'p3', aw_deep_link: 'x', product_name: 'n', search_price: 'abc' }, feed)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/marketplaces test -- awin-mapper.test.ts`
Expected: FAIL — `Cannot find module '../src/awin/mapper'`

- [ ] **Step 3: Implementar `packages/marketplaces/src/awin/mapper.ts`**

```ts
import type { AwinFeedListEntry, AwinFeedRow } from './datafeed';

export interface AwinCatalogUpsertInput {
  feedId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  externalId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  deepLink: string;
  raw: AwinFeedRow;
}

export function mapAwinRow(
  row: AwinFeedRow,
  feed: Pick<AwinFeedListEntry, 'feedId' | 'advertiserId' | 'advertiserName'>,
): AwinCatalogUpsertInput | null {
  const externalId = row.aw_product_id;
  const deepLink = row.aw_deep_link;
  const title = row.product_name;
  const price = Number(row.search_price);
  if (!externalId || !deepLink || !title || !Number.isFinite(price)) return null;

  const originalPriceNum = row.rrp_price ? Number(row.rrp_price) : NaN;
  const originalPrice =
    Number.isFinite(originalPriceNum) && originalPriceNum > price ? originalPriceNum : null;

  return {
    feedId: feed.feedId,
    advertiserId: feed.advertiserId || null,
    advertiserName: feed.advertiserName || null,
    externalId,
    title,
    price,
    originalPrice,
    imageUrl: row.merchant_image_url || null,
    deepLink,
    raw: row,
  };
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/marketplaces test -- awin-mapper.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): mapper de linha do datafeed da Awin"
```

---

### Task 4: `packages/marketplaces` — adapter da Awin e registro

**Files:**
- Modify: `packages/marketplaces/src/adapter.ts` (adiciona `AwinCredentials`)
- Create: `packages/marketplaces/src/awin/adapter.ts`
- Modify: `packages/marketplaces/src/registry.ts`
- Modify: `packages/marketplaces/src/index.ts`
- Test: `packages/marketplaces/test/awin-adapter.test.ts`

**Interfaces:**
- Consumes: `listDatafeeds` (Task 2), `UnsupportedError` (já existe em `tag-adapter.ts`).
- Produces: `interface AwinCredentials { publisherId: string; datafeedApiKey: string; feedIds: string[] }`; `function createAwinAdapter(opts?: AwinDatafeedOptions): MarketplaceAdapter<AwinCredentials>`; `function getAwinAdapter(): MarketplaceAdapter<AwinCredentials>` (em `registry.ts`).

- [ ] **Step 1: Escrever os testes do adapter**

```ts
// packages/marketplaces/test/awin-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAwinAdapter } from '../src/awin/adapter';
import { UnsupportedError } from '../src/tag-adapter';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text })) as unknown as typeof fetch;
}

const creds = { publisherId: 'pub1', datafeedApiKey: 'key1', feedIds: ['222'] };

describe('createAwinAdapter', () => {
  it('checkConnection ok quando o feedId configurado aparece na listagem', async () => {
    const csv = 'Advertiser ID,Advertiser Name,Feed ID,Feed Name,URL\n111,Loja X,222,Feed,https://x\n';
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, csv) });
    expect(await adapter.checkConnection(creds)).toEqual({ ok: true });
  });

  it('checkConnection falha quando o feedId configurado não aparece', async () => {
    const csv = 'Advertiser ID,Advertiser Name,Feed ID,Feed Name,URL\n111,Loja X,999,Feed,https://x\n';
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, csv) });
    const result = await adapter.checkConnection(creds);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('222');
  });

  it('checkConnection falha sem datafeedApiKey/feedIds', async () => {
    const adapter = createAwinAdapter();
    const result = await adapter.checkConnection({ publisherId: 'p', datafeedApiKey: '', feedIds: [] });
    expect(result.ok).toBe(false);
  });

  it('fetchByUrls sempre retorna vazio (não há lookup ao vivo por URL na Awin)', async () => {
    const adapter = createAwinAdapter();
    expect(await adapter.fetchByUrls(creds, ['https://www.awin1.com/cread.php?x'])).toEqual([]);
  });

  it('toAffiliateLink acrescenta clickref a um deep link da Awin', async () => {
    const adapter = createAwinAdapter();
    const link = await adapter.toAffiliateLink(
      creds,
      'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      'batch-1',
    );
    expect(link).toBe('https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x&clickref=batch-1');
  });

  it('toAffiliateLink lança UnsupportedError para URL fora do domínio da Awin', async () => {
    const adapter = createAwinAdapter();
    await expect(adapter.toAffiliateLink(creds, 'https://loja.com/produto', 'sub')).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/marketplaces test -- awin-adapter.test.ts`
Expected: FAIL — `Cannot find module '../src/awin/adapter'`

- [ ] **Step 3: Adicionar `AwinCredentials` em `packages/marketplaces/src/adapter.ts`**

```ts
// packages/marketplaces/src/adapter.ts — após ShopeeCredentials
export interface AwinCredentials {
  publisherId: string;
  datafeedApiKey: string;
  feedIds: string[];
}
```

- [ ] **Step 4: Implementar `packages/marketplaces/src/awin/adapter.ts`**

```ts
import type { AwinCredentials, ConnectionStatus, MarketplaceAdapter } from '../adapter';
import { UnsupportedError } from '../tag-adapter';
import { listDatafeeds, type AwinDatafeedOptions } from './datafeed';

export function createAwinAdapter(opts: AwinDatafeedOptions = {}): MarketplaceAdapter<AwinCredentials> {
  return {
    kind: 'AWIN',

    async checkConnection(creds): Promise<ConnectionStatus> {
      if (!creds?.datafeedApiKey || !creds.feedIds?.length) {
        return { ok: false, error: 'Informe a Datafeed API Key e ao menos um Feed ID' };
      }
      try {
        const feeds = await listDatafeeds(creds.datafeedApiKey, opts);
        const available = new Set(feeds.map((f) => f.feedId));
        const missing = creds.feedIds.filter((id) => !available.has(id));
        if (missing.length > 0) {
          return { ok: false, error: `Feed ID(s) não encontrado(s) na sua conta Awin: ${missing.join(', ')}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async fetchByUrls(): Promise<[]> {
      // Não há endpoint de lookup por URL ao vivo na Awin — resolvido pela camada de
      // aplicação consultando o cache local (AwinCatalogProduct), fora deste pacote.
      return [];
    },

    async toAffiliateLink(_creds, url, subId) {
      if (!url.includes('awin1.com')) {
        throw new UnsupportedError(
          'Awin: só é possível gerar link de afiliado para produtos vindos do catálogo importado',
        );
      }
      if (!subId) return url;
      const u = new URL(url);
      u.searchParams.set('clickref', subId);
      return u.toString();
    },
  };
}
```

- [ ] **Step 5: Registrar a terceira ramificação em `registry.ts`**

```ts
// packages/marketplaces/src/registry.ts (arquivo inteiro)
import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import type { AwinCredentials, MarketplaceAdapter, ShopeeCredentials } from './adapter';
import { createShopeeAdapter } from './shopee/adapter';
import { createTagAdapter, type TagKind } from './tag-adapter';
import { createAwinAdapter } from './awin/adapter';

export type AnyAdapter =
  | MarketplaceAdapter<ShopeeCredentials>
  | MarketplaceAdapter<TagCredentials>
  | MarketplaceAdapter<AwinCredentials>;

const cache = new Map<MarketplaceKind, AnyAdapter>();

/** Adapter tipado para lojas convertidas por tag (Amazon, ML, Magalu). */
export function getTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return getAdapter(kind) as MarketplaceAdapter<TagCredentials>;
}

/** Adapter tipado para a Awin. */
export function getAwinAdapter(): MarketplaceAdapter<AwinCredentials> {
  return getAdapter('AWIN') as MarketplaceAdapter<AwinCredentials>;
}

export function getAdapter(
  kind: MarketplaceKind,
  opts: { shopee?: MarketplaceAdapter<ShopeeCredentials> } = {},
): AnyAdapter {
  if (kind === 'SHOPEE' && opts.shopee) return opts.shopee;
  let a = cache.get(kind);
  if (!a) {
    a =
      kind === 'SHOPEE'
        ? createShopeeAdapter()
        : kind === 'AWIN'
          ? createAwinAdapter()
          : createTagAdapter(kind as TagKind);
    cache.set(kind, a);
  }
  return a;
}
```

- [ ] **Step 6: Exportar o novo módulo**

```ts
// packages/marketplaces/src/index.ts — adiciona
export * from './awin/datafeed';
export * from './awin/mapper';
export * from './awin/adapter';
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/marketplaces test`
Expected: PASS (toda a suíte, incluindo os novos testes)

- [ ] **Step 8: Commit**

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): adapter da Awin (checkConnection, toAffiliateLink) e registro"
```

---

### Task 5: `packages/core` — reconhecer URLs de deep link da Awin

**Files:**
- Modify: `packages/core/src/urls.ts`
- Test: `packages/core/test/urls.test.ts` (adiciona casos; se o arquivo não existir, criar seguindo o padrão dos demais testes do pacote)

**Interfaces:**
- Produces: `parseProductUrl` reconhece hostname `awin1.com`/`www.awin1.com` e retorna `{ source: 'AWIN', externalId: <awinmid ou 'unknown'> }`.

- [ ] **Step 1: Escrever o teste**

```ts
// packages/core/test/urls.test.ts — adiciona um novo describe (ou cria o arquivo com este conteúdo se ainda não existir)
import { describe, it, expect } from 'vitest';
import { parseProductUrl } from '../src/urls';

describe('parseProductUrl — Awin', () => {
  it('reconhece um deep link awin1.com e extrai o awinmid como externalId', () => {
    const result = parseProductUrl(
      'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
    );
    expect(result).toEqual({ source: 'AWIN', externalId: '111' });
  });

  it('usa "unknown" quando o link não tem awinmid', () => {
    const result = parseProductUrl('https://www.awin1.com/cread.php?ued=x');
    expect(result).toEqual({ source: 'AWIN', externalId: 'unknown' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/core test -- urls.test.ts`
Expected: FAIL — resultado atual é `{ source: 'UNSUPPORTED', reason: ... }`

- [ ] **Step 3: Implementar a branch em `parseProductUrl`**

```ts
// packages/core/src/urls.ts — adiciona antes do `return { source: 'UNSUPPORTED', ... }` final
  if (host === 'awin1.com') {
    const awinmid = u.searchParams.get('awinmid');
    return { source: 'AWIN', externalId: awinmid ?? 'unknown' };
  }
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/core test -- urls.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): parseProductUrl reconhece deep links da Awin"
```

---

### Task 6: API — credenciais, busca/lookup no cache local

**Files:**
- Modify: `apps/api/src/lib/marketplaces.ts`
- Create: `apps/api/src/lib/awin-catalog.ts`
- Test: `apps/api/test/awin-catalog.test.ts`

**Interfaces:**
- Consumes: `AwinCredentials`, `getAwinAdapter` (Task 4); `mapAwinCatalogRowToProductData` (Task 1); `TenantClient` (`@afilados/db`).
- Produces: `function loadAwinCredentials(db: TenantClient): Promise<AwinCredentials>` (lança `ApiError` se incompleta); `publicConnection(...)` inclui `awinPublisherId`, `hasAwinDatafeedApiKey`, `awinFeedIds`; `function searchAwinCatalog(db: TenantClient, keyword: string, limit: number): Promise<ProductData[]>`; `function fetchAwinCatalogByUrls(db: TenantClient, urls: string[]): Promise<ProductData[]>`.

- [ ] **Step 1: Escrever os testes de `awin-catalog.ts`**

```ts
// apps/api/test/awin-catalog.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { searchAwinCatalog, fetchAwinCatalogByUrls } from '../src/lib/awin-catalog';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-catalog-test' } })).id;
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'p1',
      title: 'Fone Bluetooth XYZ',
      price: 99.9,
      deepLink: 'https://www.awin1.com/cread.php?x=1',
      raw: {},
    },
  });
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'p2',
      title: 'Caneca de Cerâmica',
      price: 20,
      deepLink: 'https://www.awin1.com/cread.php?x=2',
      raw: {},
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('searchAwinCatalog', () => {
  it('busca por palavra-chave no título (case-insensitive)', async () => {
    const db = forTenant(tenantId);
    const found = await searchAwinCatalog(db, 'bluetooth', 20);
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('Fone Bluetooth XYZ');
    expect(found[0]!.source).toBe('AWIN');
  });

  it('não retorna nada para outro tenant', async () => {
    const other = (await prisma.tenant.create({ data: { name: 'awin-catalog-other' } })).id;
    const db = forTenant(other);
    expect(await searchAwinCatalog(db, 'bluetooth', 20)).toEqual([]);
    await prisma.tenant.deleteMany({ where: { id: other } });
  });
});

describe('fetchAwinCatalogByUrls', () => {
  it('resolve produtos por deep link exato', async () => {
    const db = forTenant(tenantId);
    const found = await fetchAwinCatalogByUrls(db, ['https://www.awin1.com/cread.php?x=1', 'https://naoexiste']);
    expect(found).toHaveLength(1);
    expect(found[0]!.externalId).toBe('p1');
  });

  it('retorna vazio para lista de urls vazia', async () => {
    const db = forTenant(tenantId);
    expect(await fetchAwinCatalogByUrls(db, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/api test -- awin-catalog.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/awin-catalog'`

- [ ] **Step 3: Implementar `apps/api/src/lib/awin-catalog.ts`**

```ts
import type { TenantClient } from '@afilados/db';
import { mapAwinCatalogRowToProductData, type ProductData } from '@afilados/shared';

function toRow(r: {
  externalId: string;
  title: string;
  price: unknown;
  originalPrice: unknown;
  imageUrl: string | null;
  deepLink: string;
  raw: unknown;
}) {
  return {
    externalId: r.externalId,
    title: r.title,
    price: Number(r.price),
    originalPrice: r.originalPrice !== null ? Number(r.originalPrice) : null,
    imageUrl: r.imageUrl,
    deepLink: r.deepLink,
    raw: r.raw,
  };
}

export async function searchAwinCatalog(
  db: TenantClient,
  keyword: string,
  limit: number,
): Promise<ProductData[]> {
  const rows = await db.awinCatalogProduct.findMany({
    where: { title: { contains: keyword, mode: 'insensitive' } },
    take: limit,
  });
  return rows.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}

export async function fetchAwinCatalogByUrls(db: TenantClient, urls: string[]): Promise<ProductData[]> {
  if (urls.length === 0) return [];
  const rows = await db.awinCatalogProduct.findMany({ where: { deepLink: { in: urls } } });
  return rows.map((r) => mapAwinCatalogRowToProductData(toRow(r)));
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/api test -- awin-catalog.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Adicionar `loadAwinCredentials`, `getAwinAdapter` e os campos públicos em `apps/api/src/lib/marketplaces.ts`**

```ts
// apps/api/src/lib/marketplaces.ts — topo: amplia os imports
import {
  createShopeeAdapter,
  getAdapter,
  getAwinAdapter,
  getTagAdapter,
  type AwinCredentials,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
```

```ts
// apps/api/src/lib/marketplaces.ts — amplia AnyCreds
type AnyCreds = {
  appId?: string;
  secret?: string;
  publisherId?: string;
  datafeedApiKey?: string;
  feedIds?: string[];
} & TagCredentials;
```

```ts
// apps/api/src/lib/marketplaces.ts — dentro de publicConnection, após hasAmazonApiSecret
    awinPublisherId: creds?.publisherId ?? null,
    hasAwinDatafeedApiKey: Boolean(creds?.datafeedApiKey),
    awinFeedIds: creds?.feedIds ?? [],
```

```ts
// apps/api/src/lib/marketplaces.ts — após loadTagCredentials
export async function loadAwinCredentials(db: TenantClient): Promise<AwinCredentials> {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'AWIN' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AwinCredentials>);
  if (!creds.publisherId || !creds.datafeedApiKey || !creds.feedIds?.length) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'AWIN: configure Publisher ID, Datafeed API Key e ao menos um Feed ID em Configurações',
      400,
    );
  }
  return creds as AwinCredentials;
}
```

```ts
// apps/api/src/lib/marketplaces.ts — no export final
export { getAdapter, getAwinAdapter, getTagAdapter };
```

- [ ] **Step 6: Rodar a suíte de lib da api**

Run: `pnpm --filter @afilados/api test -- lib`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib apps/api/test/awin-catalog.test.ts
git commit -m "feat(api): credenciais e busca no cache local da Awin"
```

---

### Task 7: API — rotas de configuração e import manual

**Files:**
- Modify: `apps/api/src/routes/marketplaces.ts`
- Test: `apps/api/test/marketplaces.test.ts` (atualiza o teste de listagem e adiciona casos da Awin)

**Interfaces:**
- Consumes: `loadAwinCredentials`, `getAwinAdapter` (Task 6); `QUEUE_AWIN_IMPORT`, `AwinImportJob` (Task 1); `getQueue` (`apps/api/src/lib/redis.ts`, já existe).
- Produces: `PUT /marketplaces/AWIN` aceita `publisherId`/`datafeedApiKey`/`feedIds`; `POST /marketplaces/awin/import` enfileira o import e responde `{ queued: true }`.

- [ ] **Step 1: Atualizar o teste que assume 4 marketplaces**

```ts
// apps/api/test/marketplaces.test.ts — dentro de 'lista as 4 lojas como UNCONFIGURED', troca o nome e a expectativa
  it('lista as 5 lojas como UNCONFIGURED', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } });
    expect(r.json().map((c: { kind: string; status: string }) => [c.kind, c.status])).toEqual([
      ['SHOPEE', 'UNCONFIGURED'],
      ['MERCADOLIVRE', 'UNCONFIGURED'],
      ['AMAZON', 'UNCONFIGURED'],
      ['MAGALU', 'UNCONFIGURED'],
      ['AWIN', 'UNCONFIGURED'],
    ]);
  });
```

- [ ] **Step 2: Adicionar os novos casos de teste da Awin ao final do describe `marketplaces`**

```ts
  it('PUT AWIN salva publisherId/datafeedApiKey/feedIds', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie },
      payload: { publisherId: 'pub1', datafeedApiKey: 'key1', feedIds: ['111', '222'] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      kind: 'AWIN',
      awinPublisherId: 'pub1',
      hasAwinDatafeedApiKey: true,
      awinFeedIds: ['111', '222'],
    });
    expect(JSON.stringify(r.json())).not.toContain('key1');
  });

  it('POST /marketplaces/awin/import enfileira o job', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/awin/import', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ queued: true });
  });
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/api test -- marketplaces.test.ts`
Expected: FAIL — `awinPublisherId` indefinido no PUT (falta a branch) e 404 em `/marketplaces/awin/import`

- [ ] **Step 4: Adicionar a branch AWIN no PUT e a rota de import**

```ts
// apps/api/src/routes/marketplaces.ts — topo, amplia imports
import {
  ApiError,
  MARKETPLACE_KINDS,
  QUEUE_AWIN_IMPORT,
  marketplaceKindParam,
  marketplaceUpdateSchema,
  marketplaceSessionSchema,
  parseCookieString,
  supportsSessionCookie,
  SESSION_FIELD_BY_KIND,
  type AwinImportJob,
} from '@afilados/shared';
import { getQueue } from '../lib/redis';
```

```ts
// apps/api/src/routes/marketplaces.ts — dentro do PUT, insere a branch AWIN antes de MERCADOLIVRE
      (prev) =>
        kind === 'SHOPEE'
          ? { appId: body.appId ?? prev.appId, secret: body.secret ?? prev.secret }
          : kind === 'AWIN'
            ? {
                publisherId: body.publisherId ?? prev.publisherId,
                datafeedApiKey: body.datafeedApiKey ?? prev.datafeedApiKey,
                feedIds: body.feedIds ?? prev.feedIds,
              }
            : kind === 'MERCADOLIVRE'
              ? {
                  mattWord: body.mattWord ?? prev.mattWord,
                  mattTool: body.mattTool ?? prev.mattTool,
                  ...(prev.mlSession ? { mlSession: prev.mlSession } : {}),
                }
              : {
                  tag: body.affiliateTag ?? prev.tag,
                  ...(prev.amazonSession ? { amazonSession: prev.amazonSession } : {}),
                  ...(prev.magaluSession ? { magaluSession: prev.magaluSession } : {}),
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

```ts
// apps/api/src/routes/marketplaces.ts — nova rota, após POST /marketplaces/:kind/session
  app.post('/marketplaces/awin/import', async (req) => {
    const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
    await q.add(
      'awin-import',
      { tenantId: req.tenantId },
      { jobId: `awin-import-${req.tenantId}-${Date.now()}`, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
    );
    return { queued: true };
  });
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/api test -- marketplaces.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/marketplaces.ts apps/api/test/marketplaces.test.ts
git commit -m "feat(api): rota de configuração e import manual da Awin"
```

---

### Task 8: API — busca manual e "adicionar por URL" (products, automations, extension)

**Files:**
- Modify: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/routes/automations.ts`
- Modify: `apps/api/src/routes/extension.ts`
- Test: `apps/api/test/products.test.ts` (adiciona casos)

**Interfaces:**
- Consumes: `searchAwinCatalog`, `fetchAwinCatalogByUrls` (Task 6).

- [ ] **Step 1: Escrever os testes de `/products/search` e import por URL para AWIN**

```ts
// apps/api/test/products.test.ts — adiciona ao describe principal (cria tenant/produto Awin em beforeAll local do describe)
describe('produtos — Awin', () => {
  it('POST /products/search com source AWIN busca no cache local', async () => {
    await prisma.awinCatalogProduct.create({
      data: {
        tenantId: t.tenantId,
        feedId: 'f1',
        externalId: 'aw1',
        title: 'Liquidificador Turbo',
        price: 150,
        deepLink: 'https://www.awin1.com/cread.php?x=aw1',
        raw: {},
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/search',
      headers: { cookie },
      payload: { source: 'AWIN', mode: 'keyword', query: 'liquidificador', limit: 10 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(1);
    expect(r.json().products[0].title).toBe('Liquidificador Turbo');
  });

  it('POST /products/import com uma URL awin1.com resolve pelo cache', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { cookie },
      payload: { urls: ['https://www.awin1.com/cread.php?x=aw1'] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/api test -- products.test.ts`
Expected: FAIL (source AWIN cai no branch `q.mode !== 'keyword'` genérico / falta as branches de rota)

- [ ] **Step 3: Adicionar a branch AWIN em `/products/search`**

```ts
// apps/api/src/routes/products.ts — topo, amplia imports
import { searchAwinCatalog, fetchAwinCatalogByUrls } from '../lib/awin-catalog';
```

```ts
// apps/api/src/routes/products.ts — dentro de app.post('/products/search', ...), logo após o bloco SHOPEE
    if (q.source === 'AWIN') {
      if (!q.query) throw ApiError.validation('Informe uma palavra-chave');
      const found = await searchAwinCatalog(req.db, q.query, q.limit);
      const rows = await upsertProducts(req.db, req.tenantId, found);
      return { products: rows.map(toApiProduct) };
    }
```

- [ ] **Step 4: Adicionar a branch AWIN no import em lote (`groupedByKind`)**

```ts
// apps/api/src/routes/products.ts — dentro do for (const [kind, kindUrls] of groupedByKind.entries()), antes de "} else if (scrapeInline) {"
        if (kind === 'SHOPEE') {
          const { creds } = await loadShopeeCredentials(req.db);
          const found = await getShopeeAdapter().fetchByUrls(creds, kindUrls);
          allFound.push(...found);
        } else if (kind === 'AWIN') {
          const found = await fetchAwinCatalogByUrls(req.db, kindUrls);
          allFound.push(...found);
          const foundUrls = new Set(found.map((f) => f.originalUrl));
          for (const u of kindUrls) {
            if (!foundUrls.has(u)) {
              unsupported.push({ url: u, reason: 'Produto Awin não encontrado no catálogo importado' });
            }
          }
        } else if (scrapeInline) {
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/api test -- products.test.ts`
Expected: PASS

- [ ] **Step 6: Adicionar a branch AWIN em `automations.ts` (link add)**

```ts
// apps/api/src/routes/automations.ts — topo, amplia imports
import { fetchAwinCatalogByUrls } from '../lib/awin-catalog';
```

```ts
// apps/api/src/routes/automations.ts — dentro de app.post('/automations/:id/queue/link', ...)
    let found;
    if (parsed.source === 'SHOPEE') {
      const { creds } = await loadShopeeCredentials(req.db);
      [found] = await getShopeeAdapter().fetchByUrls(creds, [url]);
    } else if (parsed.source === 'AWIN') {
      [found] = await fetchAwinCatalogByUrls(req.db, [url]);
    } else {
      const creds = parsed.source === 'AMAZON' ? await loadTagCredentials(req.db, parsed.source) : {};
      [found] = await getTagAdapter(parsed.source).fetchByUrls(creds, [url]);
    }
```

- [ ] **Step 7: Adicionar a branch AWIN em `extension.ts` (captura)**

```ts
// apps/api/src/routes/extension.ts — topo, amplia imports
import { fetchAwinCatalogByUrls } from '../lib/awin-catalog';
```

```ts
// apps/api/src/routes/extension.ts — dentro de app.post('/extension/capture', ...): declara tenantDb uma única vez
// logo no início da função (antes do if (body.title && ...)) e reusa nos dois branches abaixo.
    const tenantDb = forTenant(tenantId);
    let productData: ProductData;
    if (body.title && body.price !== undefined && body.price !== null) {
      // ...bloco existente sem mudanças...
    } else {
      let list: ProductData[];
      if (body.marketplaceKind === 'SHOPEE') {
        const { creds } = await loadShopeeCredentials(tenantDb);
        list = await getShopeeAdapter().fetchByUrls(creds, [body.url]);
      } else if (body.marketplaceKind === 'AWIN') {
        list = await fetchAwinCatalogByUrls(tenantDb, [body.url]);
      } else {
        const amazonCreds =
          body.marketplaceKind === 'AMAZON'
            ? await loadTagCredentials(tenantDb, body.marketplaceKind)
            : {};
        list = await getTagAdapter(body.marketplaceKind).fetchByUrls(amazonCreds, [body.url]);
      }
      const first = list[0];
      if (!first) {
        throw ApiError.validation('Não foi possível extrair os dados da página');
      }
      productData = first;
    }
    // mais abaixo, remova a declaração duplicada `const tenantDb = forTenant(tenantId);`
    // que já existia antes do upsertProducts — reusar a criada acima.
```

- [ ] **Step 8: Rodar a suíte completa da api**

Run: `pnpm --filter @afilados/api test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes
git commit -m "feat(api): busca manual e adicionar-por-URL da Awin via cache local"
```

---

### Task 9: Worker — credenciais e processor de import (upsert + poda)

**Files:**
- Modify: `apps/worker/src/lib/marketplace-credentials.ts`
- Modify: `apps/worker/src/lib/queue-helpers.ts`
- Create: `apps/worker/src/processors/awin-import.ts`
- Test: `apps/worker/test/awin-import.test.ts`

**Interfaces:**
- Consumes: `listDatafeeds`, `downloadFeed`, `mapAwinRow`, `AwinCredentials` (Task 2–4); `QUEUE_AWIN_IMPORT`, `AwinImportJob` (Task 1).
- Produces: `function loadAwinCredentials(tenantId: string): Promise<AwinCredentials>`; `function enqueueAwinImport(tenantId: string): Promise<void>`; `interface AwinImportFeedResult { feedId: string; ok: boolean; imported: number; removed: number; error?: string }`; `function importAwinCatalog(deps: AwinImportDeps, tenantId: string): Promise<AwinImportFeedResult[]>`; `function createAwinImportProcessor(deps?: AwinImportDeps)`.

- [ ] **Step 1: Escrever o teste de import + poda**

```ts
// apps/worker/test/awin-import.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { importAwinCatalog } from '../src/processors/awin-import';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-import-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({ publisherId: 'pub1', datafeedApiKey: 'key1', feedIds: ['f1', 'f2'] }),
    },
  });
  // Produto que já existia no cache e NÃO vai aparecer na nova rodada do feed f1 — deve ser podado.
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'stale-1',
      title: 'Produto Antigo',
      price: 1,
      deepLink: 'https://www.awin1.com/cread.php?x=stale',
      raw: {},
      lastImportedAt: new Date('2020-01-01'),
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('importAwinCatalog', () => {
  it('faz upsert dos produtos do feed e remove os que saíram (poda por feed)', async () => {
    const deps = {
      listDatafeeds: async () => [
        { advertiserId: '1', advertiserName: 'Loja 1', feedId: 'f1', feedName: 'Feed 1', url: 'https://x/f1' },
        { advertiserId: '2', advertiserName: 'Loja 2', feedId: 'f2', feedName: 'Feed 2', url: 'https://x/f2' },
      ],
      downloadFeed: async (url: string) =>
        url === 'https://x/f1'
          ? [
              {
                aw_product_id: 'p1',
                aw_deep_link: 'https://www.awin1.com/cread.php?x=p1',
                product_name: 'Produto Novo',
                search_price: '50.00',
              },
            ]
          : [],
    };

    const results = await importAwinCatalog(deps, tenantId);
    expect(results).toEqual([
      { feedId: 'f1', ok: true, imported: 1, removed: 1 },
      { feedId: 'f2', ok: true, imported: 0, removed: 0 },
    ]);

    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId } });
    expect(rows.map((r) => r.externalId)).toEqual(['p1']);
  });

  it('falha em um feedId não interrompe os demais', async () => {
    const deps = {
      listDatafeeds: async () => [
        { advertiserId: '1', advertiserName: 'Loja 1', feedId: 'f1', feedName: 'Feed 1', url: 'https://x/f1' },
      ],
      downloadFeed: async () => {
        throw new Error('feed indisponível');
      },
    };
    const results = await importAwinCatalog(deps, tenantId);
    expect(results[0]).toMatchObject({ feedId: 'f1', ok: false, error: 'feed indisponível' });
  });

  it('retorna vazio quando o tenant não tem AWIN configurada', async () => {
    const other = (await prisma.tenant.create({ data: { name: 'awin-import-none' } })).id;
    const results = await importAwinCatalog({}, other);
    expect(results).toEqual([]);
    await prisma.tenant.deleteMany({ where: { id: other } });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/worker test -- awin-import.test.ts`
Expected: FAIL — `Cannot find module '../src/processors/awin-import'`

- [ ] **Step 3: Implementar `apps/worker/src/processors/awin-import.ts`**

```ts
import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  downloadFeed as downloadFeedReal,
  listDatafeeds as listDatafeedsReal,
  mapAwinRow,
  type AwinCredentials,
} from '@afilados/marketplaces';
import type { AwinImportJob } from '@afilados/shared';

const log = pino({ name: 'awin-import' });

export interface AwinImportDeps {
  listDatafeeds?: typeof listDatafeedsReal;
  downloadFeed?: typeof downloadFeedReal;
}

export interface AwinImportFeedResult {
  feedId: string;
  ok: boolean;
  imported: number;
  removed: number;
  error?: string;
}

export async function importAwinCatalog(
  deps: AwinImportDeps,
  tenantId: string,
): Promise<AwinImportFeedResult[]> {
  const listDatafeeds = deps.listDatafeeds ?? listDatafeedsReal;
  const downloadFeed = deps.downloadFeed ?? downloadFeedReal;

  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
  if (!creds.datafeedApiKey || !creds.feedIds?.length) return [];

  const feeds = await listDatafeeds(creds.datafeedApiKey);
  const byId = new Map(feeds.map((f) => [f.feedId, f]));
  const results: AwinImportFeedResult[] = [];

  for (const feedId of creds.feedIds) {
    const entry = byId.get(feedId);
    if (!entry) {
      results.push({ feedId, ok: false, imported: 0, removed: 0, error: 'Feed ID não encontrado na Awin' });
      continue;
    }
    const runStartedAt = new Date();
    try {
      const rows = await downloadFeed(entry.url);
      let imported = 0;
      for (const row of rows) {
        const input = mapAwinRow(row, entry);
        if (!input) continue;
        await prisma.awinCatalogProduct.upsert({
          where: { tenantId_feedId_externalId: { tenantId, feedId, externalId: input.externalId } },
          update: {
            title: input.title,
            price: input.price,
            originalPrice: input.originalPrice,
            imageUrl: input.imageUrl,
            deepLink: input.deepLink,
            advertiserId: input.advertiserId,
            advertiserName: input.advertiserName,
            raw: input.raw,
            lastImportedAt: runStartedAt,
          },
          create: {
            tenantId,
            feedId,
            externalId: input.externalId,
            title: input.title,
            price: input.price,
            originalPrice: input.originalPrice,
            imageUrl: input.imageUrl,
            deepLink: input.deepLink,
            advertiserId: input.advertiserId,
            advertiserName: input.advertiserName,
            raw: input.raw,
            lastImportedAt: runStartedAt,
          },
        });
        imported++;
      }
      const pruned = await prisma.awinCatalogProduct.deleteMany({
        where: { tenantId, feedId, lastImportedAt: { lt: runStartedAt } },
      });
      results.push({ feedId, ok: true, imported, removed: pruned.count });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log.warn({ tenantId, feedId, error }, 'falha ao importar feed da Awin');
      results.push({ feedId, ok: false, imported: 0, removed: 0, error });
    }
  }
  return results;
}

export function createAwinImportProcessor(deps: AwinImportDeps = {}) {
  return async (job: Job<AwinImportJob>) => {
    return importAwinCatalog(deps, job.data.tenantId);
  };
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/worker test -- awin-import.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Adicionar `loadAwinCredentials` (worker) e `enqueueAwinImport`**

```ts
// apps/worker/src/lib/marketplace-credentials.ts — adiciona ao final
import type { AwinCredentials } from '@afilados/marketplaces';

export async function loadAwinCredentials(tenantId: string): Promise<AwinCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AwinCredentials>);
  if (!creds.publisherId || !creds.datafeedApiKey || !creds.feedIds?.length) {
    throw new Error('AWIN: configure Publisher ID, Datafeed API Key e ao menos um Feed ID');
  }
  return creds as AwinCredentials;
}
```

```ts
// apps/worker/src/lib/queue-helpers.ts — amplia import e adiciona ao final
import { QUEUE_AWIN_IMPORT, QUEUE_SEND_OFFER, QUEUE_SEND_TELEGRAM, type AwinImportJob, type SendOfferJob, type SendTelegramJob } from '@afilados/shared';

export async function enqueueAwinImport(tenantId: string) {
  const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
  await q.add(
    'awin-import',
    { tenantId },
    { jobId: `awin-import-${tenantId}-${Date.now()}`, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
  );
}
```

- [ ] **Step 6: Rodar a suíte de worker/lib**

Run: `pnpm --filter @afilados/worker test -- lib`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/processors/awin-import.ts apps/worker/src/lib apps/worker/test/awin-import.test.ts
git commit -m "feat(worker): processor de import da Awin com poda de produtos obsoletos"
```

---

### Task 10: Worker — scheduler periódico e fiação no `main.ts`

**Files:**
- Create: `apps/worker/src/automation/awin-import-scheduler.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/awin-import-scheduler.test.ts`

**Interfaces:**
- Consumes: `enqueueAwinImport` (Task 9).
- Produces: `class AwinImportScheduler { start(): void; stop(): void; tick(): Promise<void> }`.

- [ ] **Step 1: Escrever o teste do scheduler**

```ts
// apps/worker/test/awin-import-scheduler.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AwinImportScheduler } from '../src/automation/awin-import-scheduler';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-scheduler-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: { tenantId, kind: 'AWIN', status: 'OK', encryptedCredentials: encryptJson({ publisherId: 'p', datafeedApiKey: 'k', feedIds: ['f1'] }) },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('AwinImportScheduler.tick', () => {
  it('enfileira o import de todos os tenants com AWIN configurada', async () => {
    const enqueued: string[] = [];
    const scheduler = new AwinImportScheduler({ enqueue: async (t) => void enqueued.push(t) });
    await scheduler.tick();
    expect(enqueued).toContain(tenantId);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/worker test -- awin-import-scheduler.test.ts`
Expected: FAIL — `Cannot find module '../src/automation/awin-import-scheduler'`

- [ ] **Step 3: Implementar o scheduler**

```ts
// apps/worker/src/automation/awin-import-scheduler.ts
import pino from 'pino';
import { prisma } from '@afilados/db';
import { enqueueAwinImport } from '../lib/queue-helpers';

const log = pino({ name: 'awin-import-scheduler' });
const INTERVAL_MS = Number(process.env.AWIN_IMPORT_INTERVAL_HOURS ?? 12) * 60 * 60 * 1000;

export interface AwinImportSchedulerDeps {
  enqueue?: (tenantId: string) => Promise<void>;
}

export class AwinImportScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly enqueue: (tenantId: string) => Promise<void>;

  constructor(deps: AwinImportSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? enqueueAwinImport;
  }

  start() {
    this.timer = setInterval(() => {
      void this.tick().catch((e) => log.error(e, 'falha no tick de import da Awin'));
    }, INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const conns = await prisma.marketplaceConnection.findMany({
      where: { kind: 'AWIN', encryptedCredentials: { not: null } },
      select: { tenantId: true },
    });
    for (const { tenantId } of conns) {
      await this.enqueue(tenantId);
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/worker test -- awin-import-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Registrar o worker da fila, o scheduler e o encerramento gracioso em `main.ts`**

```ts
// apps/worker/src/main.ts — amplia imports
import {
  QUEUE_AWIN_IMPORT,
  QUEUE_MIRROR_MESSAGE,
  QUEUE_PRODUCT_ENRICH,
  QUEUE_SEND_OFFER,
  QUEUE_SEND_TELEGRAM,
  QUEUE_WA_COMMANDS,
  REDIS_EVENTS_CHANNEL,
  type AwinImportJob,
  type MirrorMessageJob,
  type ProductEnrichJob,
  type SendOfferJob,
  type SendTelegramJob,
  type WaCommandJob,
} from '@afilados/shared';
import { createAwinAdapter } from '@afilados/marketplaces';
import { createAwinImportProcessor } from './processors/awin-import';
import { AwinImportScheduler } from './automation/awin-import-scheduler';
```

```ts
// apps/worker/src/main.ts — junto às demais instâncias de topo
const awinImportScheduler = new AwinImportScheduler();
```

```ts
// apps/worker/src/main.ts — junto aos demais Worker<...>
const awinImportWorker = new Worker<AwinImportJob>(QUEUE_AWIN_IMPORT, createAwinImportProcessor(), {
  connection: getRedis(),
  concurrency: 1,
});
```

```ts
// apps/worker/src/main.ts — no array de workers que recebe o listener 'failed' genérico
for (const w of [waWorker, sendWorker, mirrorWorker, enrichWorker, telegramWorker, awinImportWorker]) {
```

```ts
// apps/worker/src/main.ts — junto ao start() dos demais schedulers
await automationScheduler.start();
awinImportScheduler.start();
```

```ts
// apps/worker/src/main.ts — dentro de shutdown(), junto aos demais stop()/close()
    automationScheduler.stop();
    awinImportScheduler.stop();
    ...
    await Promise.all([
      waWorker.close(),
      sendWorker.close(),
      mirrorWorker.close(),
      enrichWorker.close(),
      telegramWorker.close(),
      awinImportWorker.close(),
    ]);
```

- [ ] **Step 6: Rodar a suíte completa do worker**

Run: `pnpm --filter @afilados/worker test`
Expected: PASS

- [ ] **Step 7: Verificar que o worker sobe sem erros**

Run: `pnpm --filter @afilados/worker build`
Expected: build TypeScript sem erros (confirma que `main.ts` compila com as novas importações).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/automation/awin-import-scheduler.ts apps/worker/src/main.ts apps/worker/test/awin-import-scheduler.test.ts
git commit -m "feat(worker): scheduler periódico de import da Awin e fiação no main"
```

---

### Task 11: Worker — descoberta por automação (`discoverAwin`)

**Files:**
- Modify: `apps/worker/src/automation/discovery.ts`
- Test: `apps/worker/test/automation-discovery.test.ts` (adiciona um describe)

**Interfaces:**
- Consumes: `mapAwinCatalogRowToProductData` (Task 1).
- Produces: `discoverForRule` passa a suportar `marketplace === 'AWIN'` nas `rule.marketplaces`.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/worker/test/automation-discovery.test.ts — novo describe, no mesmo arquivo (reaproveita tenantId do beforeAll existente)
describe('discoverForRule (Awin)', () => {
  it('busca no cache local por palavra-chave e enfileira os elegíveis', async () => {
    await prisma.marketplaceConnection.create({
      data: { tenantId, kind: 'AWIN', status: 'OK', encryptedCredentials: encryptJson({ publisherId: 'p', datafeedApiKey: 'k', feedIds: ['f1'] }) },
    });
    await prisma.awinCatalogProduct.create({
      data: {
        tenantId,
        feedId: 'f1',
        externalId: 'aw-fone',
        title: 'Fone de Ouvido Bluetooth',
        price: 80,
        deepLink: 'https://www.awin1.com/cread.php?x=aw-fone',
        raw: {},
      },
    });

    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule-awin',
        marketplaces: ['AWIN'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's-awin' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't-awin', body: 'x' } })).id,
      },
    });

    await discoverForRule(rule);

    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id }, include: { product: true } });
    expect(items).toHaveLength(1);
    expect(items[0]!.product!.title).toBe('Fone de Ouvido Bluetooth');
    expect(items[0]!.product!.source).toBe('AWIN');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/worker test -- automation-discovery.test.ts`
Expected: FAIL — `discoverForRule` ainda não sabe lidar com `marketplace === 'AWIN'` (cai no branch de scraping e lança/ignora)

- [ ] **Step 3: Implementar `discoverAwin` e ligar no `discoverForRule`**

```ts
// apps/worker/src/automation/discovery.ts — topo, amplia imports
import { mapAwinCatalogRowToProductData } from '@afilados/shared';
```

```ts
// apps/worker/src/automation/discovery.ts — nova função, após discoverShopee
async function discoverAwin(rule: AutomationRule, keyword: string): Promise<ProductData[]> {
  const rows = await prisma.awinCatalogProduct.findMany({
    where: { tenantId: rule.tenantId, title: { contains: keyword, mode: 'insensitive' } },
    take: 20,
  });
  return rows.map((r) =>
    mapAwinCatalogRowToProductData({
      externalId: r.externalId,
      title: r.title,
      price: Number(r.price),
      originalPrice: r.originalPrice !== null ? Number(r.originalPrice) : null,
      imageUrl: r.imageUrl,
      deepLink: r.deepLink,
      raw: r.raw,
    }),
  );
}
```

```ts
// apps/worker/src/automation/discovery.ts — dentro de discoverForRule, troca o if/else que escolhe a estratégia
  let results: ProductData[];
  try {
    results =
      marketplace === 'SHOPEE'
        ? await discoverShopee(rule, keyword, deps)
        : marketplace === 'AWIN'
          ? await discoverAwin(rule, keyword)
          : await discoverScraped(marketplace, keyword, rule, deps);
  } catch (e) {
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/worker test -- automation-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/automation/discovery.ts apps/worker/test/automation-discovery.test.ts
git commit -m "feat(worker): automação de descoberta busca a Awin no cache local"
```

---

### Task 12: Worker — envio (link de afiliado no disparo WhatsApp e Telegram)

**Files:**
- Modify: `apps/worker/src/processors/send-offer.ts`
- Modify: `apps/worker/src/processors/send-telegram.ts`
- Modify: `apps/worker/src/main.ts` (injeta `awin` nos dois processors)
- Test: `apps/worker/test/send-offer.test.ts` (adiciona caso)

**Interfaces:**
- Consumes: `AwinCredentials`, `MarketplaceAdapter<AwinCredentials>`, `createAwinAdapter` (Task 4).
- Produces: `SendOfferDeps.awin` e `SendTelegramDeps.awin: MarketplaceAdapter<AwinCredentials>`.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/worker/test/send-offer.test.ts — adiciona um novo it dentro do describe existente, copiando o
// setup (fixtures de tenant/batch/gateway mock) já usado pelo caso do caminho Shopee neste arquivo,
// trocando o produto para source: 'AWIN', originalUrl: 'https://www.awin1.com/cread.php?x=1', e a
// MarketplaceConnection para kind: 'AWIN' com encryptedCredentials de um AwinCredentials válido.
it('gera o link de afiliado da Awin com clickref no envio', async () => {
  const awin = {
    kind: 'AWIN' as const,
    checkConnection: async () => ({ ok: true }),
    fetchByUrls: async () => [],
    toAffiliateLink: async (_creds: unknown, url: string, subId?: string) => `${url}&clickref=${subId}`,
  };
  const result = await sendOffer({ gateway, shopee, awin }, batchItem.id);
  expect(result.outcome).toBe('sent');
  // Confere na mensagem capturada pelo gateway mock que a URL final contém "&clickref="
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @afilados/worker test -- send-offer.test.ts`
Expected: FAIL — falta o campo `awin` em `SendOfferDeps` (erro de tipo) e a branch específica em `send-offer.ts`

- [ ] **Step 3: Adicionar o branch AWIN em `send-offer.ts`**

```ts
// apps/worker/src/processors/send-offer.ts — topo, amplia o import já existente de @afilados/marketplaces
import { getTagAdapter, type AwinCredentials, type MarketplaceAdapter, type ShopeeCredentials } from '@afilados/marketplaces';
```

```ts
// apps/worker/src/processors/send-offer.ts — SendOfferDeps ganha o campo awin
export interface SendOfferDeps {
  gateway: WaGateway;
  shopee: MarketplaceAdapter<ShopeeCredentials>;
  awin: MarketplaceAdapter<AwinCredentials>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  bucketFor?: (sessionId: string, ratePerMin: number) => { take(): Promise<number> };
  getTagAdapter?: typeof getTagAdapter;
  enqueueTelegram?: (job: SendTelegramJob & { jobId: string }) => Promise<void>;
}
```

```ts
// apps/worker/src/processors/send-offer.ts — troca o bloco de geração do link de afiliado
    let affiliateLink = product.originalUrl;
    if (product.source === 'SHOPEE' && conn?.encryptedCredentials) {
      const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
      const subId = generateSubId(subIdPattern, {
        now: t,
        batchId: batch.id,
        timezone: window.timezone,
      });
      affiliateLink = await deps.shopee.toAffiliateLink(creds, product.originalUrl, subId);
    } else if (product.source === 'AWIN' && conn?.encryptedCredentials) {
      const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
      const subId = generateSubId(subIdPattern, {
        now: t,
        batchId: batch.id,
        timezone: window.timezone,
      });
      try {
        affiliateLink = await deps.awin.toAffiliateLink(creds, product.originalUrl, subId);
      } catch (err) {
        log.warn({ batchItemId: item.id, err }, 'falha ao gerar link de afiliado da Awin; usando link original');
      }
    } else if (
      product.source !== 'SHOPEE' &&
      product.source !== 'AWIN' &&
      product.source !== 'MANUAL' &&
      conn?.encryptedCredentials
    ) {
      const creds = decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials));
      try {
        affiliateLink = await resolveTagAdapter(product.source).toAffiliateLink(
          creds,
          product.originalUrl,
        );
      } catch (err) {
        log.warn(
          { batchItemId: item.id, source: product.source, err },
          'falha ao gerar link de afiliado; usando link original',
        );
      }
    }
```

- [ ] **Step 4: Repetir o mesmo padrão em `send-telegram.ts`**

```ts
// apps/worker/src/processors/send-telegram.ts — amplia o import existente de @afilados/marketplaces e SendTelegramDeps
import { getTagAdapter, type AwinCredentials, type MarketplaceAdapter, type ShopeeCredentials } from '@afilados/marketplaces';

export interface SendTelegramDeps {
  shopee: MarketplaceAdapter<ShopeeCredentials>;
  awin: MarketplaceAdapter<AwinCredentials>;
  now?: () => Date;
  getTagAdapter?: typeof getTagAdapter;
  makeClient?: (token: string) => TelegramClient;
}
```

```ts
// apps/worker/src/processors/send-telegram.ts — troca o bloco de geração do link (mesma lógica do send-offer, usando job.botId como batchId do subId)
      let affiliateLink = product.originalUrl;
      if (product.source === 'SHOPEE' && conn?.encryptedCredentials) {
        const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = generateSubId(subIdPattern, { now: t, batchId: job.botId });
        affiliateLink = await deps.shopee.toAffiliateLink(creds, product.originalUrl, subId);
      } else if (product.source === 'AWIN' && conn?.encryptedCredentials) {
        const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = generateSubId(subIdPattern, { now: t, batchId: job.botId });
        try {
          affiliateLink = await deps.awin.toAffiliateLink(creds, product.originalUrl, subId);
        } catch (err) {
          log.warn({ botId: job.botId, err }, 'falha ao gerar link de afiliado da Awin; usando link original');
        }
      } else if (
        product.source !== 'SHOPEE' &&
        product.source !== 'AWIN' &&
        product.source !== 'MANUAL' &&
        conn?.encryptedCredentials
      ) {
        const creds = decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials));
        try {
          affiliateLink = await resolveTagAdapter(product.source).toAffiliateLink(
            creds,
            product.originalUrl,
          );
        } catch (err) {
          log.warn(
            { botId: job.botId, source: product.source, err },
            'falha ao gerar link de afiliado; usando link original',
          );
        }
      }
```

- [ ] **Step 5: Injetar `createAwinAdapter()` nos dois processors em `main.ts`**

```ts
// apps/worker/src/main.ts — troca as duas linhas que criam sendWorker e telegramWorker
const sendWorker = new Worker<SendOfferJob>(
  QUEUE_SEND_OFFER,
  processSendOffer({ gateway, shopee: createShopeeAdapter(), awin: createAwinAdapter() }),
  { connection: getRedis(), concurrency: 1 },
);
...
const telegramWorker = new Worker<SendTelegramJob>(
  QUEUE_SEND_TELEGRAM,
  processSendTelegram({ shopee: createShopeeAdapter(), awin: createAwinAdapter() }),
  { connection: getRedis(), concurrency: 2 },
);
```

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `pnpm --filter @afilados/worker test`
Expected: PASS (toda a suíte, incluindo `send-offer.test.ts` e o equivalente de `send-telegram.ts` se existir)

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/processors/send-offer.ts apps/worker/src/processors/send-telegram.ts apps/worker/src/main.ts apps/worker/test/send-offer.test.ts
git commit -m "feat(worker): gera link de afiliado da Awin (clickref) no envio WhatsApp e Telegram"
```

---

### Task 13: Web — configuração da Awin e botão de import

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/components/marketplaces/marketplace-config.ts`
- Modify: `apps/web/src/components/marketplaces/marketplace-drawer.tsx`
- Modify: `apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx`

**Interfaces:**
- Consumes: resposta pública de `/marketplaces` (Task 7): `awinPublisherId`, `hasAwinDatafeedApiKey`, `awinFeedIds`.

- [ ] **Step 1: Ampliar `MarketplaceConnection` em `types.ts`**

```ts
// apps/web/src/lib/types.ts — dentro de MarketplaceConnection, após hasAmazonApiSecret
  awinPublisherId: string | null;
  hasAwinDatafeedApiKey: boolean;
  awinFeedIds: string[];
```

- [ ] **Step 2: Adicionar a entrada AWIN em `MARKETPLACE_CONFIGS`**

```ts
// apps/web/src/components/marketplaces/marketplace-config.ts — amplia MarketplaceFieldKey
export type MarketplaceFieldKey =
  | 'appId'
  | 'secret'
  | 'affiliateTag'
  | 'mattWord'
  | 'mattTool'
  | 'amazonClientId'
  | 'amazonClientSecret'
  | 'publisherId'
  | 'datafeedApiKey'
  | 'feedIds';
```

```ts
// apps/web/src/components/marketplaces/marketplace-config.ts — dentro de MARKETPLACE_CONFIGS, adiciona a chave AWIN
  AWIN: {
    kind: 'AWIN',
    label: 'Awin',
    description: 'Publisher ID e Datafeed API Key — importa o catálogo dos programas que você participa.',
    platformUrl: 'https://ui.awin.com/',
    fields: [
      {
        key: 'publisherId',
        label: 'Publisher ID',
        type: 'text',
        required: true,
        placeholder: 'Ex: 1234567',
        helpTitle: 'Onde encontro meu Publisher ID?',
        helpContent: 'No canto superior do painel da Awin, ao lado do nome da sua conta de publisher.',
      },
      {
        key: 'datafeedApiKey',
        label: 'Datafeed API Key',
        type: 'password',
        required: true,
        helpTitle: 'Onde consigo a Datafeed API Key?',
        helpContent: 'Painel Awin → Toolbox → Create-a-Feed → copie a chave usada na URL de download dos feeds.',
      },
      {
        key: 'feedIds',
        label: 'Feed IDs (separados por vírgula)',
        type: 'text',
        required: true,
        placeholder: 'Ex: 111111, 222222',
        helpTitle: 'Onde encontro o Feed ID de um programa?',
        helpContent: 'Painel Awin → Toolbox → Create-a-Feed → coluna "Feed ID" do programa que você quer importar.',
      },
    ],
    supportsSession: false,
  },
```

- [ ] **Step 3: Tratar `feedIds` como lista no drawer (valor inicial e serialização no submit)**

```ts
// apps/web/src/components/marketplaces/marketplace-drawer.tsx — dentro de initialFieldValue, adiciona os casos
    case 'publisherId':
      return connection?.awinPublisherId ?? '';
    case 'feedIds':
      return connection?.awinFeedIds?.join(', ') ?? '';
    case 'datafeedApiKey':
      return '';
```

```ts
// apps/web/src/components/marketplaces/marketplace-drawer.tsx — dentro de handleSubmit, troca o loop de montagem de `fields`
    const fields: Partial<Record<MarketplaceFieldKey, string>> = {};
    for (const field of config.fields) {
      const value = values[field.key]?.trim();
      if (!value) continue;
      fields[field.key] = value;
    }
```

> O campo `feedIds` continua sendo enviado como string separada por vírgula em `payload.fields.feedIds` — o parse para array de fato acontece no componente pai (`marketplaces-client.tsx`, Step 5).

- [ ] **Step 4: Adicionar o botão "Importar agora" no drawer, visível só para AWIN**

```ts
// apps/web/src/components/marketplaces/marketplace-drawer.tsx — amplia as props do componente
  onImportNow,
  importPending,
}: {
  kind: MarketplaceKind;
  connection?: MarketplaceConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: MarketplaceSubmitPayload) => Promise<void>;
  pending: boolean;
  feedback: MarketplaceFeedback | null;
  onImportNow?: () => Promise<void>;
  importPending?: boolean;
}) {
```

```tsx
{/* apps/web/src/components/marketplaces/marketplace-drawer.tsx — dentro do <form>, logo antes de displayedFeedback */}
          {kind === 'AWIN' && onImportNow && (
            <div className="rounded-lg border border-border bg-surface-2 p-3.5">
              <p className="mb-2 text-sm font-medium">Catálogo importado</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Reimporta automaticamente a cada 12h. Use o botão abaixo para atualizar agora.
              </p>
              <Button type="button" variant="outline" disabled={importPending} onClick={onImportNow}>
                {importPending ? 'Importando...' : 'Importar agora'}
              </Button>
            </div>
          )}
```

- [ ] **Step 5: Fazer `feedIds` virar array antes de enviar, e ligar o botão de import**

```ts
// apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx — troca handleSubmit e o JSX do MarketplaceDrawer
  async function handleSubmit(kind: MarketplaceKind, payload: MarketplaceSubmitPayload) {
    setPending(true);
    setFeedback(null);
    try {
      if (Object.keys(payload.fields).length > 0) {
        const body: Record<string, unknown> = { ...payload.fields };
        if (typeof body.feedIds === 'string') {
          body.feedIds = body.feedIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        await apiFetch(`/marketplaces/${kind}`, { method: 'PUT', json: body });
      }
      ...
```

```tsx
{/* apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx — dentro do MarketplaceDrawer renderizado */}
        <MarketplaceDrawer
          kind={openKind}
          connection={marketplaces.find((m) => m.kind === openKind)}
          open
          onOpenChange={(v) => {
            if (!v) closeDrawer();
          }}
          onSubmit={(payload) => handleSubmit(openKind, payload)}
          pending={pending}
          feedback={feedback}
          onImportNow={
            openKind === 'AWIN'
              ? async () => {
                  setImportPending(true);
                  try {
                    await apiFetch('/marketplaces/awin/import', { method: 'POST' });
                    setFeedback({ message: 'Import solicitado — os produtos aparecem em alguns minutos.', ok: true });
                  } catch (err) {
                    setFeedback({ message: err instanceof Error ? err.message : 'Falha ao solicitar import.', ok: false });
                  } finally {
                    setImportPending(false);
                  }
                }
              : undefined
          }
          importPending={importPending}
        />
```

```ts
// apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx — adiciona o novo state junto aos demais useState
  const [importPending, setImportPending] = useState(false);
```

- [ ] **Step 6: Rodar o build/typecheck da web**

Run: `pnpm --filter web build`
Expected: build sem erros de tipo.

- [ ] **Step 7: Conferir manualmente no navegador**

Run: `pnpm dev` (ou o comando de dev já usado no projeto)
Ação: abrir `/marketplaces`, confirmar que o card "Awin" aparece na grade, o drawer abre com os campos Publisher ID/Datafeed API Key/Feed IDs, e o botão "Importar agora" aparece só quando a Awin já tem alguma credencial salva.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): tela de configuração da Awin e botão de importar catálogo"
```

---

### Task 14: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Rodar a suíte inteira do monorepo**

Run: `pnpm -r test`
Expected: PASS em todos os pacotes/apps.

- [ ] **Step 2: Rodar o typecheck/build de todos os apps**

Run: `pnpm -r build`
Expected: build sem erros (confirma que nenhuma das ramificações novas quebrou o compilador em `products.ts`, `automations.ts`, `extension.ts`, `send-offer.ts`, `send-telegram.ts`).

- [ ] **Step 3: Conferir a migration aplicada em dev**

Run: `pnpm --filter @afilados/db exec prisma migrate status`
Expected: nenhuma migration pendente.

- [ ] **Step 4: Commit final (se sobrar algum ajuste de lint/format)**

```bash
git add -A
git commit -m "chore: ajustes finais da integração Awin"
```
