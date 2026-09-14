# F1-A — Fundação (monorepo, shared, core, db, adapter Shopee) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o monorepo e os pacotes de base (`shared`, `core`, `db`, `marketplaces`) com toda a lógica de negócio da Fase 1 testada, sem ainda existir API, worker ou web.

**Architecture:** Monorepo pnpm + Turborepo. `packages/shared` tem tipos e schemas Zod; `packages/core` tem funções puras (template, janela, agendamento, shuffle, URLs, SubID); `packages/db` tem Prisma (schema completo da F1 + tabelas futuras mínimas), helper de tenant, criptografia e seed; `packages/marketplaces` tem a interface de adapter e o adapter Shopee (assinatura + GraphQL + modo mock). Tudo com Vitest.

**Tech Stack:** Node 22, pnpm 9, Turborepo 2, TypeScript 5 strict, Vitest 2, Zod 3, Luxon 3, Prisma 5, PostgreSQL 16 (Docker), Redis 7 (Docker).

## Global Constraints

- TypeScript `strict: true`, `moduleResolution: "Bundler"`, ESM (`"type": "module"`) em todos os pacotes.
- `packages/core` não importa Prisma, Baileys, `fetch` nem `node:*` — só `luxon` e `@afilados/shared`.
- Toda tabela de negócio no Prisma tem `tenantId String` + relação com `Tenant`.
- Timezone padrão `America/Sao_Paulo`; preços formatados `R$ 1.234,56`; desconto `-25% OFF`.
- Nomes de pacotes: `@afilados/shared`, `@afilados/core`, `@afilados/db`, `@afilados/marketplaces`.
- Commits em português, prefixo convencional (`feat:`, `test:`, `chore:`), terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Comandos abaixo assumem shell POSIX (Git Bash no Windows) na raiz `D:\apps\afilados`.

## File Structure

```
package.json                     raiz: scripts turbo, devDeps compartilhadas
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
vitest.workspace.ts
.env.example
docker-compose.yml               postgres + redis (dev)
packages/shared/
  package.json, tsconfig.json
  src/index.ts                   re-exports
  src/enums.ts                   MarketplaceKind, MediaMode, etc. (espelham o Prisma)
  src/product.ts                 tipo ProductData + zod
  src/search.ts                  SearchQuery zod
  src/template.ts                TemplateContext
  src/events.ts                  eventos WS/pubsub tipados
packages/core/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts
  src/money.ts                   formatBRL, discountLabel
  src/template.ts                renderTemplate, flashSaleLabel
  src/window.ts                  isWithinOperatingWindow, nextWindowOpen
  src/schedule.ts                scheduleBatch
  src/shuffle.ts                 shuffleInterleaved
  src/urls.ts                    parseProductUrl
  src/subid.ts                   generateSubId
  test/*.test.ts                 um arquivo por módulo
packages/db/
  package.json, tsconfig.json, vitest.config.ts
  prisma/schema.prisma
  prisma/seed.ts
  src/index.ts                   prisma client singleton + forTenant
  src/crypto.ts                  encryptJson / decryptJson (AES-256-GCM)
  test/crypto.test.ts
  test/tenant.test.ts            (integração, precisa do Postgres do compose)
packages/marketplaces/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts
  src/adapter.ts                 interface MarketplaceAdapter + tipos
  src/shopee/signature.ts        buildShopeeAuthHeader
  src/shopee/client.ts           ShopeeGraphQLClient
  src/shopee/mapper.ts           productOffer → ProductData
  src/shopee/adapter.ts          createShopeeAdapter (real + mock)
  src/shopee/fixtures/*.json
  test/shopee.*.test.ts
```

---

### Task 1: Scaffold do monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.env.example`, `docker-compose.yml`, `.prettierrc`, `.npmrc`

**Interfaces:**
- Produces: scripts raiz `pnpm build | test | lint | typecheck | db:migrate | db:seed`; `tsconfig.base.json` que todos os pacotes estendem.

- [ ] **Step 1: Criar `package.json` raiz**

```json
{
  "name": "afilados",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "turbo run typecheck",
    "lint": "prettier --check .",
    "format": "prettier --write .",
    "db:migrate": "pnpm --filter @afilados/db migrate:dev",
    "db:deploy": "pnpm --filter @afilados/db migrate:deploy",
    "db:seed": "pnpm --filter @afilados/db seed",
    "db:generate": "pnpm --filter @afilados/db generate"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "prettier": "^3.3.3",
    "turbo": "^2.1.3",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Criar `pnpm-workspace.yaml`, `.npmrc`, `.prettierrc`**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc`:
```
auto-install-peers=true
strict-peer-dependencies=false
```

`.prettierrc`:
```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 3: Criar `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "generate": { "cache": false },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: Criar `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 5: Criar `vitest.workspace.ts`**

```ts
export default ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'];
```

- [ ] **Step 6: Criar `.env.example`**

```
# Banco e fila
DATABASE_URL=postgresql://afilados:afilados@localhost:5432/afilados
REDIS_URL=redis://localhost:6379

# Segurança (gere com: openssl rand -hex 32)
APP_ENCRYPTION_KEY=
SESSION_SECRET=

# Seed
SEED_USER_EMAIL=admin@example.com
SEED_USER_PASSWORD=troque-esta-senha

# Marketplaces
SHOPEE_MOCK=1

# Deploy
DOMAIN=localhost
```

- [ ] **Step 7: Criar `docker-compose.yml` (dev)**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: afilados
      POSTGRES_PASSWORD: afilados
      POSTGRES_DB: afilados
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U afilados"]
      interval: 5s
      retries: 10
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redisdata:/data"]
volumes:
  pgdata:
  redisdata:
```

- [ ] **Step 8: Instalar e verificar**

Run: `pnpm install && docker compose up -d && docker compose ps`
Expected: instalação sem erro; `postgres` e `redis` com status `running (healthy)`/`running`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold do monorepo (pnpm, turbo, vitest, docker compose dev)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `@afilados/shared` — enums, tipos e schemas

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/{index,enums,product,search,template,events}.ts`
- Test: `packages/shared/test/search.test.ts`

**Interfaces:**
- Produces:
  - `enums.ts`: `MarketplaceKind = 'SHOPEE'|'MERCADOLIVRE'|'AMAZON'|'MAGALU'`, `ProductSource = MarketplaceKind|'MANUAL'`, `Shipping = 'NONE'|'FREE'|'FULL'|'UNKNOWN'`, `MediaMode = 'IMAGE'|'PREVIEW'`, `WaSessionStatus`, `BatchStatus`, `BatchItemStatus`.
  - `product.ts`: `ProductData` (zod `productDataSchema`) — campos: `source, externalId?, title, price, originalPrice?, discountPct?, salesCount?, commissionPct?, images: string[], shipping, flashSaleEndsAt?: string(ISO), couponCode?, couponValue?, originalUrl, shopId?, shopName?, raw: unknown`.
  - `search.ts`: `searchQuerySchema`, `SearchQuery`, `SearchSort = 'DISCOUNT_DESC'|'COMMISSION_DESC'|'SALES_DESC'|'PRICE_ASC'|'PRICE_DESC'`, `SearchMode = 'keyword'|'category'|'trending'|'shop'`.
  - `template.ts`: `TemplateContext = { affiliateLink: string; cta?: string; now: string }`.
  - `events.ts`: `RealtimeEvent` união discriminada por `type`; `REDIS_EVENTS_CHANNEL`.

- [ ] **Step 1: `package.json`, `tsconfig.json`, `vitest.config.ts`**

`packages/shared/package.json`:
```json
{
  "name": "@afilados/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: Teste que falha — `test/search.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { searchQuerySchema } from '../src/search';

describe('searchQuerySchema', () => {
  it('aplica defaults', () => {
    const q = searchQuerySchema.parse({ source: 'SHOPEE', mode: 'keyword', query: 'ryzen' });
    expect(q).toEqual({
      source: 'SHOPEE',
      mode: 'keyword',
      query: 'ryzen',
      sort: 'DISCOUNT_DESC',
      limit: 100,
      topSellers: false,
      extraCommission: false,
    });
  });

  it('exige query no modo keyword', () => {
    expect(() => searchQuerySchema.parse({ source: 'SHOPEE', mode: 'keyword' })).toThrow();
  });

  it('exige shopId no modo shop', () => {
    expect(() => searchQuerySchema.parse({ source: 'SHOPEE', mode: 'shop' })).toThrow();
  });

  it('limita limit a 500', () => {
    expect(() =>
      searchQuerySchema.parse({ source: 'SHOPEE', mode: 'trending', limit: 501 }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `pnpm --filter @afilados/shared test`
Expected: FAIL — `Cannot find module '../src/search'`.

- [ ] **Step 4: Implementar `src/enums.ts`**

```ts
export const MARKETPLACE_KINDS = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU'] as const;
export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number];

export const PRODUCT_SOURCES = [...MARKETPLACE_KINDS, 'MANUAL'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

export const SHIPPINGS = ['NONE', 'FREE', 'FULL', 'UNKNOWN'] as const;
export type Shipping = (typeof SHIPPINGS)[number];

export const MEDIA_MODES = ['IMAGE', 'PREVIEW'] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];

export const WA_SESSION_STATUSES = [
  'DISCONNECTED',
  'CONNECTING',
  'NEEDS_QR',
  'CONNECTED',
  'LOGGED_OUT',
] as const;
export type WaSessionStatus = (typeof WA_SESSION_STATUSES)[number];

export const BATCH_STATUSES = ['SCHEDULED', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_ITEM_STATUSES = ['PENDING', 'SENDING', 'SENT', 'ERROR'] as const;
export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];
```

- [ ] **Step 5: Implementar `src/product.ts`**

```ts
import { z } from 'zod';
import { PRODUCT_SOURCES, SHIPPINGS } from './enums';

export const productDataSchema = z.object({
  source: z.enum(PRODUCT_SOURCES),
  externalId: z.string().min(1).optional(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  originalPrice: z.number().nonnegative().optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
  salesCount: z.number().int().nonnegative().optional(),
  commissionPct: z.number().nonnegative().optional(),
  images: z.array(z.string().url()).default([]),
  shipping: z.enum(SHIPPINGS).default('UNKNOWN'),
  flashSaleEndsAt: z.string().datetime().optional(),
  couponCode: z.string().optional(),
  couponValue: z.number().nonnegative().optional(),
  originalUrl: z.string().url(),
  shopId: z.string().optional(),
  shopName: z.string().optional(),
  raw: z.unknown(),
});
export type ProductData = z.infer<typeof productDataSchema>;
```

- [ ] **Step 6: Implementar `src/search.ts`**

```ts
import { z } from 'zod';
import { MARKETPLACE_KINDS } from './enums';

export const SEARCH_SORTS = [
  'DISCOUNT_DESC',
  'COMMISSION_DESC',
  'SALES_DESC',
  'PRICE_ASC',
  'PRICE_DESC',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_MODES = ['keyword', 'category', 'trending', 'shop'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const searchQuerySchema = z
  .object({
    source: z.enum(MARKETPLACE_KINDS),
    mode: z.enum(SEARCH_MODES),
    query: z.string().trim().min(1).optional(),
    categoryId: z.string().optional(),
    shopId: z.string().optional(),
    sort: z.enum(SEARCH_SORTS).default('DISCOUNT_DESC'),
    limit: z.number().int().min(1).max(500).default(100),
    topSellers: z.boolean().default(false),
    extraCommission: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.mode === 'keyword' && !q.query)
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query obrigatória' });
    if (q.mode === 'category' && !q.categoryId)
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'categoryId obrigatório' });
    if (q.mode === 'shop' && !q.shopId)
      ctx.addIssue({ code: 'custom', path: ['shopId'], message: 'shopId obrigatório' });
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;
```

- [ ] **Step 7: Implementar `src/template.ts` e `src/events.ts`**

`src/template.ts`:
```ts
export interface TemplateContext {
  /** Link já convertido para a tag de afiliado. */
  affiliateLink: string;
  /** Frase de CTA sorteada (F4); vazio na F1. */
  cta?: string;
  /** Instante do disparo, ISO 8601 — usado por {oferta_relampago}. */
  now: string;
}
```

`src/events.ts`:
```ts
import type { WaSessionStatus, BatchItemStatus } from './enums';

export type RealtimeEvent =
  | { type: 'wa.qr'; sessionId: string; qr: string }
  | { type: 'wa.pair-code'; sessionId: string; code: string }
  | { type: 'wa.status'; sessionId: string; status: WaSessionStatus; phone?: string }
  | { type: 'wa.groups.synced'; sessionId: string; count: number }
  | { type: 'batch.progress'; batchId: string; sent: number; total: number; estimatedEndAt: string }
  | { type: 'batch.item'; batchId: string; itemId: string; status: BatchItemStatus; error?: string }
  | { type: 'error'; code: string; message: string };

export const REDIS_EVENTS_CHANNEL = 'afilados:events';
```

- [ ] **Step 8: `src/index.ts`**

```ts
export * from './enums';
export * from './product';
export * from './search';
export * from './template';
export * from './events';
```

- [ ] **Step 9: Rodar testes e typecheck**

Run: `pnpm install && pnpm --filter @afilados/shared test && pnpm --filter @afilados/shared typecheck`
Expected: 4 testes PASS; typecheck sem erros.

- [ ] **Step 10: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): enums, ProductData, SearchQuery e eventos realtime

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `@afilados/core` — dinheiro e renderTemplate

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/{index,money,template}.ts`
- Test: `packages/core/test/money.test.ts`, `packages/core/test/template.test.ts`

**Interfaces:**
- Consumes: `ProductData`, `TemplateContext` de `@afilados/shared`.
- Produces:
  - `formatBRL(value: number): string` → `R$ 1.234,56`
  - `discountLabel(pct?: number): string` → `-25% OFF` ou `''`
  - `flashSaleLabel(endsAt: string | undefined, nowIso: string): string`
  - `renderTemplate(body: string, product: ProductData, ctx: TemplateContext): string`

- [ ] **Step 1: Arquivos de pacote**

`packages/core/package.json`:
```json
{
  "name": "@afilados/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@afilados/shared": "workspace:*", "luxon": "^3.5.0" },
  "devDependencies": { "@types/luxon": "^3.4.2", "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], coverage: { include: ['src/**'] } },
});
```

- [ ] **Step 2: Teste de dinheiro — `test/money.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatBRL, discountLabel } from '../src/money';

describe('formatBRL', () => {
  it('formata com separador de milhar e vírgula', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(99.9)).toBe('R$ 99,90');
  });
});

describe('discountLabel', () => {
  it('gera -NN% OFF', () => {
    expect(discountLabel(25)).toBe('-25% OFF');
  });
  it('vazio quando não há desconto', () => {
    expect(discountLabel(undefined)).toBe('');
    expect(discountLabel(0)).toBe('');
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `pnpm install && pnpm --filter @afilados/core test`
Expected: FAIL — módulo `../src/money` não existe.

- [ ] **Step 4: Implementar `src/money.ts`**

```ts
export function formatBRL(value: number): string {
  const fixed = value.toFixed(2); // "1234.50"
  const [intPart = '0', dec = '00'] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${dec}`;
}

export function discountLabel(pct?: number): string {
  if (!pct || pct <= 0) return '';
  return `-${Math.round(pct)}% OFF`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/core test`
Expected: 3 PASS.

- [ ] **Step 6: Teste de template — `test/template.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { ProductData } from '@afilados/shared';
import { renderTemplate } from '../src/template';

const product: ProductData = {
  source: 'SHOPEE',
  externalId: '123',
  title: 'Processador AMD Ryzen 5',
  price: 848.48,
  originalPrice: 1200,
  discountPct: 29,
  salesCount: 6,
  commissionPct: 3,
  images: ['https://img.example/a.jpg'],
  shipping: 'FREE',
  originalUrl: 'https://shopee.com.br/p-i.1.123',
  raw: {},
};
const ctx = { affiliateLink: 'https://s.shopee.com.br/abc', now: '2026-09-14T12:00:00.000Z' };

describe('renderTemplate', () => {
  it('substitui variáveis básicas', () => {
    const out = renderTemplate('*{titulo}*\nDe {preco_antigo} por {preco} ({desconto})\n{link}', product, ctx);
    expect(out).toBe(
      '*Processador AMD Ryzen 5*\nDe R$ 1.200,00 por R$ 848,48 (-29% OFF)\nhttps://s.shopee.com.br/abc',
    );
  });

  it('renderiza frete', () => {
    expect(renderTemplate('{frete}', product, ctx)).toBe('Frete grátis');
    expect(renderTemplate('{frete}', { ...product, shipping: 'FULL' }, ctx)).toBe('Envio FULL');
    expect(renderTemplate('{frete}', { ...product, shipping: 'NONE' }, ctx)).toBe('');
    expect(renderTemplate('{frete_gratis}', product, ctx)).toBe('🚚 FRETE GRÁTIS');
    expect(renderTemplate('{frete_full}', product, ctx)).toBe('');
  });

  it('remove a linha inteira de um bloco condicional vazio', () => {
    const body = 'A\n{#cupom}Cupom: {cupom}{/cupom}\nB';
    expect(renderTemplate(body, product, ctx)).toBe('A\nB');
    expect(renderTemplate(body, { ...product, couponCode: 'X10' }, ctx)).toBe('A\nCupom: X10\nB');
  });

  it('calcula oferta relâmpago a partir de now', () => {
    const p = { ...product, flashSaleEndsAt: '2026-09-14T12:47:00.000Z' };
    expect(renderTemplate('{oferta_relampago}', p, ctx)).toBe('⚡ Faltam 47 minutos para expirar');
    expect(renderTemplate('{oferta_relampago}', product, ctx)).toBe('');
    const expired = { ...product, flashSaleEndsAt: '2026-09-14T11:00:00.000Z' };
    expect(renderTemplate('{oferta_relampago}', expired, ctx)).toBe('');
  });

  it('vendas, cupom e cta', () => {
    expect(renderTemplate('{vendas}', product, ctx)).toBe('6');
    expect(renderTemplate('{cta}', product, { ...ctx, cta: 'Corra!' })).toBe('Corra!');
    expect(renderTemplate('{cta}', product, ctx)).toBe('');
  });

  it('mantém texto sem variáveis intacto', () => {
    expect(renderTemplate('sem nada', product, ctx)).toBe('sem nada');
  });
});
```

- [ ] **Step 7: Rodar para ver falhar**

Run: `pnpm --filter @afilados/core test`
Expected: FAIL — `../src/template` não existe.

- [ ] **Step 8: Implementar `src/template.ts`**

```ts
import { DateTime } from 'luxon';
import type { ProductData, TemplateContext } from '@afilados/shared';
import { formatBRL, discountLabel } from './money';

export function flashSaleLabel(endsAt: string | undefined, nowIso: string): string {
  if (!endsAt) return '';
  const end = DateTime.fromISO(endsAt);
  const now = DateTime.fromISO(nowIso);
  const minutes = Math.floor(end.diff(now, 'minutes').minutes);
  if (minutes <= 0) return '';
  if (minutes < 60) return `⚡ Faltam ${minutes} minutos para expirar`;
  const hours = Math.floor(minutes / 60);
  return `⚡ Faltam ${hours}h${String(minutes % 60).padStart(2, '0')} para expirar`;
}

function buildVars(p: ProductData, ctx: TemplateContext): Record<string, string> {
  return {
    titulo: p.title,
    preco: formatBRL(p.price),
    preco_antigo: p.originalPrice ? formatBRL(p.originalPrice) : '',
    desconto: discountLabel(p.discountPct),
    vendas: p.salesCount !== undefined ? String(p.salesCount) : '',
    link: ctx.affiliateLink,
    cupom: p.couponCode ?? '',
    oferta_relampago: flashSaleLabel(p.flashSaleEndsAt, ctx.now),
    frete: p.shipping === 'FREE' ? 'Frete grátis' : p.shipping === 'FULL' ? 'Envio FULL' : '',
    frete_gratis: p.shipping === 'FREE' ? '🚚 FRETE GRÁTIS' : '',
    frete_full: p.shipping === 'FULL' ? '📦 ENVIO FULL' : '',
    cta: ctx.cta ?? '',
  };
}

const BLOCK_RE = /\{#(\w+)\}([\s\S]*?)\{\/\1\}/g;
const VAR_RE = /\{(\w+)\}/g;

/**
 * Renderiza o template do usuário.
 * - `{var}` → valor (string vazia se ausente).
 * - `{#var}...{/var}` → conteúdo só quando `var` não é vazio; se vazio e o bloco
 *   ocupava a linha inteira, a linha é removida.
 */
export function renderTemplate(body: string, product: ProductData, ctx: TemplateContext): string {
  const vars = buildVars(product, ctx);
  const withBlocks = body.replace(BLOCK_RE, (_m, name: string, inner: string) =>
    vars[name] ? inner : '',
  );
  const substituted = withBlocks.replace(VAR_RE, (m, name: string) => vars[name] ?? m);
  // Remove linhas que ficaram vazias por causa de bloco condicional
  const originalLines = body.split('\n');
  const outLines = substituted.split('\n');
  if (originalLines.length !== outLines.length) return substituted;
  return outLines
    .filter((line, i) => !(line.trim() === '' && /\{#\w+\}/.test(originalLines[i] ?? '')))
    .join('\n');
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `pnpm --filter @afilados/core test`
Expected: todos PASS (money 3 + template 6).

- [ ] **Step 10: `src/index.ts` e commit**

```ts
export * from './money';
export * from './template';
```

```bash
git add packages/core
git commit -m "feat(core): formatBRL, discountLabel e renderTemplate com blocos condicionais

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `core` — janela de operação

**Files:**
- Create: `packages/core/src/window.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/window.test.ts`

**Interfaces:**
- Produces:
  - `OperatingWindow = { startTime: string /*HH:mm*/; endTime: string; timezone: string; enabled: boolean }`
  - `isWithinOperatingWindow(now: Date, w: OperatingWindow): boolean`
  - `nextWindowOpen(now: Date, w: OperatingWindow): Date` — retorna `now` se já está dentro.

- [ ] **Step 1: Teste — `test/window.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isWithinOperatingWindow, nextWindowOpen, type OperatingWindow } from '../src/window';

const w: OperatingWindow = {
  startTime: '07:30',
  endTime: '23:30',
  timezone: 'America/Sao_Paulo',
  enabled: true,
};
// São Paulo = UTC-3 (sem horário de verão desde 2019)
const sp = (s: string) => new Date(`${s}-03:00`);

describe('isWithinOperatingWindow', () => {
  it('dentro', () => expect(isWithinOperatingWindow(sp('2026-09-14T12:00:00'), w)).toBe(true));
  it('antes', () => expect(isWithinOperatingWindow(sp('2026-09-14T07:29:59'), w)).toBe(false));
  it('no início é dentro', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T07:30:00'), w)).toBe(true));
  it('no fim é fora', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T23:30:00'), w)).toBe(false));
  it('desabilitada = sempre dentro', () =>
    expect(isWithinOperatingWindow(sp('2026-09-14T03:00:00'), { ...w, enabled: false })).toBe(true));
  it('janela que cruza meia-noite', () => {
    const night = { ...w, startTime: '22:00', endTime: '02:00' };
    expect(isWithinOperatingWindow(sp('2026-09-14T23:00:00'), night)).toBe(true);
    expect(isWithinOperatingWindow(sp('2026-09-15T01:00:00'), night)).toBe(true);
    expect(isWithinOperatingWindow(sp('2026-09-15T03:00:00'), night)).toBe(false);
  });
});

describe('nextWindowOpen', () => {
  it('retorna now quando dentro', () => {
    const now = sp('2026-09-14T12:00:00');
    expect(nextWindowOpen(now, w)).toEqual(now);
  });
  it('antes da abertura → abertura de hoje', () => {
    expect(nextWindowOpen(sp('2026-09-14T05:00:00'), w)).toEqual(sp('2026-09-14T07:30:00'));
  });
  it('depois do fechamento → abertura de amanhã', () => {
    expect(nextWindowOpen(sp('2026-09-14T23:45:00'), w)).toEqual(sp('2026-09-15T07:30:00'));
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/core test -- window`
Expected: FAIL — `../src/window` não existe.

- [ ] **Step 3: Implementar `src/window.ts`**

```ts
import { DateTime } from 'luxon';

export interface OperatingWindow {
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  timezone: string; // IANA
  enabled: boolean;
}

function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function localMinutes(now: Date, tz: string): number {
  const d = DateTime.fromJSDate(now, { zone: tz });
  return d.hour * 60 + d.minute + d.second / 60;
}

export function isWithinOperatingWindow(now: Date, w: OperatingWindow): boolean {
  if (!w.enabled) return true;
  const cur = localMinutes(now, w.timezone);
  const start = toMinutes(w.startTime);
  const end = toMinutes(w.endTime);
  if (start <= end) return cur >= start && cur < end;
  // cruza meia-noite
  return cur >= start || cur < end;
}

export function nextWindowOpen(now: Date, w: OperatingWindow): Date {
  if (isWithinOperatingWindow(now, w)) return now;
  const d = DateTime.fromJSDate(now, { zone: w.timezone });
  const [h = '0', m = '0'] = w.startTime.split(':');
  let open = d.set({ hour: Number(h), minute: Number(m), second: 0, millisecond: 0 });
  if (open <= d) open = open.plus({ days: 1 });
  return open.toJSDate();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/core test -- window`
Expected: 9 PASS.

- [ ] **Step 5: Exportar e commitar**

Adicionar em `src/index.ts`: `export * from './window';`

```bash
git add packages/core
git commit -m "feat(core): janela de operação com suporte a timezone e virada de meia-noite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `core` — agendamento de lote

**Files:**
- Create: `packages/core/src/schedule.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/schedule.test.ts`

**Interfaces:**
- Consumes: `OperatingWindow`, `isWithinOperatingWindow`, `nextWindowOpen` (Task 4).
- Produces: `scheduleBatch(count: number, intervalMin: number, window: OperatingWindow, startAt: Date): { runAt: Date[]; estimatedEndAt: Date | null }`

- [ ] **Step 1: Teste — `test/schedule.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { scheduleBatch } from '../src/schedule';
import type { OperatingWindow } from '../src/window';

const w: OperatingWindow = { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };
const sp = (s: string) => new Date(`${s}-03:00`);

describe('scheduleBatch', () => {
  it('lote vazio', () => {
    expect(scheduleBatch(0, 10, w, sp('2026-09-14T12:00:00'))).toEqual({ runAt: [], estimatedEndAt: null });
  });

  it('espaça pelo intervalo dentro da janela', () => {
    const { runAt, estimatedEndAt } = scheduleBatch(3, 10, w, sp('2026-09-14T12:00:00'));
    expect(runAt).toEqual([sp('2026-09-14T12:00:00'), sp('2026-09-14T12:10:00'), sp('2026-09-14T12:20:00')]);
    expect(estimatedEndAt).toEqual(sp('2026-09-14T12:20:00'));
  });

  it('pula o período fechado (critério de aceite do spec)', () => {
    const { runAt } = scheduleBatch(2, 10, w, sp('2026-09-14T23:25:00'));
    expect(runAt).toEqual([sp('2026-09-14T23:25:00'), sp('2026-09-15T07:30:00')]);
  });

  it('começa na próxima abertura se criado fora da janela', () => {
    const { runAt } = scheduleBatch(1, 10, w, sp('2026-09-14T02:00:00'));
    expect(runAt).toEqual([sp('2026-09-14T07:30:00')]);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/core test -- schedule`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/schedule.ts`**

```ts
import { isWithinOperatingWindow, nextWindowOpen, type OperatingWindow } from './window';

export interface BatchSchedule {
  runAt: Date[];
  estimatedEndAt: Date | null;
}

export function scheduleBatch(
  count: number,
  intervalMin: number,
  window: OperatingWindow,
  startAt: Date,
): BatchSchedule {
  const runAt: Date[] = [];
  let cursor = nextWindowOpen(startAt, window);
  for (let i = 0; i < count; i++) {
    if (!isWithinOperatingWindow(cursor, window)) cursor = nextWindowOpen(cursor, window);
    runAt.push(cursor);
    cursor = new Date(cursor.getTime() + intervalMin * 60_000);
  }
  return { runAt, estimatedEndAt: runAt.at(-1) ?? null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/core test -- schedule`
Expected: 4 PASS.

- [ ] **Step 5: Exportar e commitar**

`src/index.ts`: `export * from './schedule';`

```bash
git add packages/core
git commit -m "feat(core): scheduleBatch respeitando janela de operação

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `core` — shuffle intercalado, parse de URL e SubID

**Files:**
- Create: `packages/core/src/shuffle.ts`, `packages/core/src/urls.ts`, `packages/core/src/subid.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/shuffle.test.ts`, `packages/core/test/urls.test.ts`, `packages/core/test/subid.test.ts`

**Interfaces:**
- Produces:
  - `shuffleInterleaved<T>(items: T[], keyOf: (t: T) => string, rng?: () => number): T[]`
  - `parseProductUrl(url: string): { source: MarketplaceKind; externalId: string; shopId?: string } | { source: 'UNSUPPORTED'; reason: string }`
  - `generateSubId(pattern: string, ctx: { now: Date; batchId?: string; groupJid?: string; timezone?: string }): string` — tokens `{yyyyMMdd}`, `{HHmm}`, `{batchId}`, `{group}`; resultado só `[A-Za-z0-9_-]`, máx. 50 chars.

- [ ] **Step 1: Testes**

`test/shuffle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { shuffleInterleaved } from '../src/shuffle';

describe('shuffleInterleaved', () => {
  it('intercala fontes em round-robin', () => {
    const items = ['s1', 's2', 's3', 'm1', 'm2', 'a1'];
    const keyOf = (s: string) => s[0]!;
    const rng = () => 0; // determinístico: sem embaralhar dentro da fonte
    const out = shuffleInterleaved(items, keyOf, rng);
    expect(out).toHaveLength(6);
    expect(out.map(keyOf).slice(0, 3).sort()).toEqual(['a', 'm', 's']);
    expect(new Set(out)).toEqual(new Set(items));
  });
  it('fonte única mantém todos os itens', () => {
    const out = shuffleInterleaved([1, 2, 3], () => 'x', () => 0.5);
    expect(out.sort()).toEqual([1, 2, 3]);
  });
});
```

`test/urls.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseProductUrl } from '../src/urls';

describe('parseProductUrl', () => {
  it('shopee formato -i.shop.item', () => {
    expect(parseProductUrl('https://shopee.com.br/Processador-AMD-i.123456.987654?sp_atk=x')).toEqual({
      source: 'SHOPEE', shopId: '123456', externalId: '987654',
    });
  });
  it('shopee formato /product/shop/item', () => {
    expect(parseProductUrl('https://shopee.com.br/product/123456/987654')).toEqual({
      source: 'SHOPEE', shopId: '123456', externalId: '987654',
    });
  });
  it('mercado livre MLB', () => {
    expect(parseProductUrl('https://www.mercadolivre.com.br/produto/p/MLB12345678')).toEqual({
      source: 'MERCADOLIVRE', externalId: 'MLB12345678',
    });
    expect(parseProductUrl('https://produto.mercadolivre.com.br/MLB-1234567890-nome-_JM')).toEqual({
      source: 'MERCADOLIVRE', externalId: 'MLB1234567890',
    });
  });
  it('amazon ASIN', () => {
    expect(parseProductUrl('https://www.amazon.com.br/Nome/dp/B0ABCDEF12/ref=x')).toEqual({
      source: 'AMAZON', externalId: 'B0ABCDEF12',
    });
  });
  it('magalu', () => {
    expect(parseProductUrl('https://www.magazineluiza.com.br/nome/p/abc123def4/te/ab12/')).toEqual({
      source: 'MAGALU', externalId: 'abc123def4',
    });
  });
  it('encurtadores e desconhecidos são UNSUPPORTED', () => {
    expect(parseProductUrl('https://s.shopee.com.br/abc').source).toBe('UNSUPPORTED');
    expect(parseProductUrl('https://meli.la/abc').source).toBe('UNSUPPORTED');
    expect(parseProductUrl('nao-e-url').source).toBe('UNSUPPORTED');
  });
});
```

`test/subid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateSubId } from '../src/subid';

describe('generateSubId', () => {
  const now = new Date('2026-09-14T15:04:00-03:00');
  it('substitui tokens', () => {
    expect(generateSubId('{yyyyMMdd}-{batchId}', { now, batchId: 'ckx1' })).toBe('20260914-ckx1');
  });
  it('sanitiza e limita', () => {
    const out = generateSubId('{group}', { now, groupJid: '5511999@g.us' });
    expect(out).toBe('5511999gus');
    expect(generateSubId('x'.repeat(80), { now })).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/core test`
Expected: FAIL nos três arquivos novos.

- [ ] **Step 3: Implementar**

`src/shuffle.ts`:
```ts
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Embaralha cada fonte e depois intercala em round-robin,
 * evitando blocos monotemáticos (ex.: 10 Shopee seguidos).
 */
export function shuffleInterleaved<T>(
  items: T[],
  keyOf: (t: T) => string,
  rng: () => number = Math.random,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it);
  }
  const queues = shuffleInPlace([...buckets.values()].map((b) => shuffleInPlace(b, rng)), rng);
  const out: T[] = [];
  while (out.length < items.length) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}
```

`src/urls.ts`:
```ts
import type { MarketplaceKind } from '@afilados/shared';

export type ParsedProductUrl =
  | { source: MarketplaceKind; externalId: string; shopId?: string }
  | { source: 'UNSUPPORTED'; reason: string };

export function parseProductUrl(raw: string): ParsedProductUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { source: 'UNSUPPORTED', reason: 'URL inválida' };
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname;

  if (host === 'shopee.com.br') {
    const m1 = path.match(/-i\.(\d+)\.(\d+)/);
    if (m1) return { source: 'SHOPEE', shopId: m1[1]!, externalId: m1[2]! };
    const m2 = path.match(/^\/product\/(\d+)\/(\d+)/);
    if (m2) return { source: 'SHOPEE', shopId: m2[1]!, externalId: m2[2]! };
  }
  if (host.endsWith('mercadolivre.com.br')) {
    const m = path.match(/MLB-?(\d+)/);
    if (m) return { source: 'MERCADOLIVRE', externalId: `MLB${m[1]}` };
  }
  if (host === 'amazon.com.br') {
    const m = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (m) return { source: 'AMAZON', externalId: m[1]! };
  }
  if (host === 'magazineluiza.com.br') {
    const m = path.match(/\/p\/([a-z0-9]+)\//);
    if (m) return { source: 'MAGALU', externalId: m[1]! };
  }
  return { source: 'UNSUPPORTED', reason: `Domínio ou formato não reconhecido: ${host}${path}` };
}
```

`src/subid.ts`:
```ts
import { DateTime } from 'luxon';

export interface SubIdContext {
  now: Date;
  batchId?: string;
  groupJid?: string;
  timezone?: string;
}

export function generateSubId(pattern: string, ctx: SubIdContext): string {
  const d = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone ?? 'America/Sao_Paulo' });
  const out = pattern
    .replaceAll('{yyyyMMdd}', d.toFormat('yyyyLLdd'))
    .replaceAll('{HHmm}', d.toFormat('HHmm'))
    .replaceAll('{batchId}', ctx.batchId ?? '')
    .replaceAll('{group}', ctx.groupJid ?? '');
  return out.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/core test && pnpm --filter @afilados/core typecheck`
Expected: todos PASS, sem erros de tipo.

- [ ] **Step 5: Exportar e commitar**

`src/index.ts` adiciona: `export * from './shuffle'; export * from './urls'; export * from './subid';`

```bash
git add packages/core
git commit -m "feat(core): shuffleInterleaved, parseProductUrl e generateSubId

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `@afilados/db` — schema Prisma, migration e client

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/.env`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/test/tenant.test.ts` (integração — usa o Postgres do compose)

**Interfaces:**
- Produces: `prisma` (PrismaClient singleton), `forTenant(tenantId: string)` que devolve um client estendido onde leituras/`updateMany`/`deleteMany` das tabelas com `tenantId` recebem o filtro automaticamente e `create` recebe o `tenantId`; tipos gerados `@prisma/client` re-exportados.

- [ ] **Step 1: Arquivos de pacote**

`packages/db/package.json`:
```json
{
  "name": "@afilados/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "seed": "tsx prisma/seed.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": { "@prisma/client": "^5.20.0", "@afilados/shared": "workspace:*" },
  "devDependencies": {
    "prisma": "^5.20.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1",
    "@node-rs/argon2": "^2.0.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "prisma"] }
```

`packages/db/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 30_000 },
});
```

`packages/db/.env` (Prisma lê o `.env` do próprio pacote; já ignorado pelo `.gitignore` raiz):
```
DATABASE_URL=postgresql://afilados:afilados@localhost:5432/afilados
```

- [ ] **Step 2: `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------- Conta / multi-tenant ----------
model Tenant {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())

  users             User[]
  waSessions        WaSession[]
  waGroups          WaGroup[]
  connections       MarketplaceConnection[]
  products          Product[]
  queueItems        QueueItem[]
  templates         Template[]
  operatingWindow   OperatingWindow?
  batches           Batch[]
  sendLogs          SendLog[]
  settings          Setting[]
  subscriptions     Subscription[]
  mirrorRules       MirrorRule[]
  coupons           Coupon[]
  scheduledMessages ScheduledMessage[]
}

enum UserRole {
  OWNER
  MEMBER
}

model User {
  id           String    @id @default(cuid())
  tenantId     String
  tenant       Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email        String    @unique
  passwordHash String
  name         String
  role         UserRole  @default(OWNER)
  createdAt    DateTime  @default(now())
  sessions     Session[]
}

model Session {
  id        String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
}

// Reservado para F7
model Plan {
  id            String         @id @default(cuid())
  name          String
  priceCents    Int
  features      Json
  subscriptions Subscription[]
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  CANCELLED
}

model Subscription {
  id       String             @id @default(cuid())
  tenantId String
  tenant   Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  planId   String
  plan     Plan               @relation(fields: [planId], references: [id])
  status   SubscriptionStatus
  startsAt DateTime
  endsAt   DateTime?
}

// ---------- WhatsApp ----------
enum WaSessionStatus {
  DISCONNECTED
  CONNECTING
  NEEDS_QR
  CONNECTED
  LOGGED_OUT
}

model WaSession {
  id         String          @id @default(cuid())
  tenantId   String
  tenant     Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  label      String
  phone      String?
  status     WaSessionStatus @default(DISCONNECTED)
  authCreds  Json?
  lastQr     String?
  pairCode   String?
  lastSeenAt DateTime?
  createdAt  DateTime        @default(now())
  authKeys   WaAuthKey[]
  groups     WaGroup[]
  batches    Batch[]
}

model WaAuthKey {
  sessionId String
  session   WaSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  type      String
  keyId     String
  value     Json

  @@id([sessionId, type, keyId])
}

enum WaGroupKind {
  GROUP
  COMMUNITY
  CHANNEL
}

model WaGroup {
  id          String      @id @default(cuid())
  tenantId    String
  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessionId   String
  session     WaSession   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  jid         String
  name        String
  kind        WaGroupKind @default(GROUP)
  botIsAdmin  Boolean     @default(false)
  memberCount Int         @default(0)
  inviteLink  String?
  syncedAt    DateTime    @default(now())

  @@unique([sessionId, jid])
  @@index([tenantId])
}

// ---------- Marketplaces ----------
enum MarketplaceKind {
  SHOPEE
  MERCADOLIVRE
  AMAZON
  MAGALU
}

enum ConnectionStatus {
  UNCONFIGURED
  OK
  ERROR
}

model MarketplaceConnection {
  id                   String           @id @default(cuid())
  tenantId             String
  tenant               Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kind                 MarketplaceKind
  encryptedCredentials Bytes?
  affiliateTag         String?
  status               ConnectionStatus @default(UNCONFIGURED)
  lastCheckedAt        DateTime?
  lastError            String?

  @@unique([tenantId, kind])
}

// ---------- Produtos / fila ----------
enum ProductSource {
  SHOPEE
  MERCADOLIVRE
  AMAZON
  MAGALU
  MANUAL
}

enum Shipping {
  NONE
  FREE
  FULL
  UNKNOWN
}

model Product {
  id              String        @id @default(cuid())
  tenantId        String
  tenant          Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  source          ProductSource
  externalId      String?
  title           String
  price           Decimal       @db.Decimal(12, 2)
  originalPrice   Decimal?      @db.Decimal(12, 2)
  discountPct     Int?
  salesCount      Int?
  commissionPct   Decimal?      @db.Decimal(5, 2)
  images          String[]
  shipping        Shipping      @default(UNKNOWN)
  flashSaleEndsAt DateTime?
  couponCode      String?
  couponValue     Decimal?      @db.Decimal(12, 2)
  originalUrl     String
  shopId          String?
  shopName        String?
  raw             Json
  createdAt       DateTime      @default(now())
  queueItems      QueueItem[]
  batchItems      BatchItem[]

  @@unique([tenantId, source, externalId])
}

enum QueueItemStatus {
  PENDING
  SENT
  ERROR
}

model QueueItem {
  id        String          @id @default(cuid())
  tenantId  String
  tenant    Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  productId String
  product   Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  selected  Boolean         @default(true)
  status    QueueItemStatus @default(PENDING)
  addedAt   DateTime        @default(now())

  @@unique([tenantId, productId])
}

// ---------- Templates / janela / settings ----------
model Template {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  body      String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  batches   Batch[]

  @@index([tenantId])
}

model OperatingWindow {
  tenantId  String  @id
  tenant    Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  startTime String  @default("07:30")
  endTime   String  @default("23:30")
  timezone  String  @default("America/Sao_Paulo")
  enabled   Boolean @default(true)
}

model Setting {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  key      String
  value    Json

  @@id([tenantId, key])
}

// ---------- Lotes / envio ----------
enum MediaMode {
  IMAGE
  PREVIEW
}

enum BatchStatus {
  SCHEDULED
  RUNNING
  PAUSED
  DONE
  CANCELLED
}

enum BatchItemStatus {
  PENDING
  SENDING
  SENT
  ERROR
}

enum SendStatus {
  SENT
  ERROR
}

model Batch {
  id             String      @id @default(cuid())
  tenantId       String
  tenant         Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessionId      String
  session        WaSession   @relation(fields: [sessionId], references: [id])
  templateId     String
  template       Template    @relation(fields: [templateId], references: [id])
  name           String
  groupJids      String[]
  intervalMin    Int
  mediaMode      MediaMode   @default(IMAGE)
  shuffled       Boolean     @default(false)
  status         BatchStatus @default(SCHEDULED)
  estimatedEndAt DateTime?
  createdAt      DateTime    @default(now())
  items          BatchItem[]

  @@index([tenantId, status])
}

model BatchItem {
  id        String          @id @default(cuid())
  batchId   String
  batch     Batch           @relation(fields: [batchId], references: [id], onDelete: Cascade)
  productId String
  product   Product         @relation(fields: [productId], references: [id])
  order     Int
  runAt     DateTime
  status    BatchItemStatus @default(PENDING)
  error     String?
  sendLogs  SendLog[]

  @@unique([batchId, productId])
}

model SendLog {
  id          String     @id @default(cuid())
  tenantId    String
  tenant      Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batchItemId String?
  batchItem   BatchItem? @relation(fields: [batchItemId], references: [id], onDelete: SetNull)
  groupJid    String
  waMessageId String?
  status      SendStatus
  error       String?
  sentAt      DateTime   @default(now())

  @@unique([batchItemId, groupJid])
  @@index([tenantId, sentAt])
}

// ---------- Reservado para fases futuras (schema mínimo) ----------
enum MirrorMode {
  TEMPLATE
  CLONE
}

model MirrorRule {
  id         String     @id @default(cuid())
  tenantId   String
  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sourceJids String[]
  targetJids String[]
  mode       MirrorMode @default(CLONE)
  mediaMode  MediaMode  @default(PREVIEW)
  enabled    Boolean    @default(true)
  createdAt  DateTime   @default(now())
}

model Coupon {
  id          String          @id @default(cuid())
  tenantId    String
  tenant      Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  store       MarketplaceKind
  code        String
  description String
  expiresAt   DateTime?
  sourceUrl   String?
  fetchedAt   DateTime        @default(now())

  @@unique([tenantId, store, code])
}

model ScheduledMessage {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  body      String
  times     String[] // "HH:mm", até 3
  groupJids String[]
  enabled   Boolean  @default(true)
}
```

- [ ] **Step 3: Gerar client e criar migration inicial**

Run: `pnpm install && pnpm --filter @afilados/db generate && pnpm --filter @afilados/db exec prisma migrate dev --name init`
Expected: pasta `packages/db/prisma/migrations/<timestamp>_init/` criada; mensagem "Your database is now in sync with your schema".

- [ ] **Step 4: Teste de isolamento — `test/tenant.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '../src/index';

let a: string;
let b: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'A' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'B' } })).id;
  await prisma.template.create({ data: { tenantId: a, name: 'ta', body: 'x' } });
  await prisma.template.create({ data: { tenantId: b, name: 'tb', body: 'y' } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('forTenant', () => {
  it('findMany só vê o próprio tenant', async () => {
    const rows = await forTenant(a).template.findMany();
    expect(rows.map((r) => r.name)).toEqual(['ta']);
  });
  it('create injeta tenantId', async () => {
    const t = await forTenant(b).template.create({ data: { name: 'tb2', body: 'z' } });
    expect(t.tenantId).toBe(b);
  });
  it('updateMany em registro de outro tenant não afeta nada', async () => {
    const other = await prisma.template.findFirstOrThrow({ where: { tenantId: a } });
    const res = await forTenant(b).template.updateMany({ where: { id: other.id }, data: { name: 'hack' } });
    expect(res.count).toBe(0);
  });
});
```

- [ ] **Step 5: Rodar para ver falhar**

Run: `pnpm --filter @afilados/db test`
Expected: FAIL — `../src/index` não existe.

- [ ] **Step 6: Implementar `src/index.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Modelos que possuem coluna tenantId e devem ser filtrados automaticamente. */
const TENANT_MODELS = new Set([
  'User',
  'WaSession',
  'WaGroup',
  'MarketplaceConnection',
  'Product',
  'QueueItem',
  'Template',
  'Batch',
  'SendLog',
  'Setting',
  'Subscription',
  'MirrorRule',
  'Coupon',
  'ScheduledMessage',
]);

const FILTERED_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'updateMany',
  'deleteMany',
  'aggregate',
  'groupBy',
]);

/**
 * Client escopado por tenant: injeta `tenantId` em `where` de leituras/updateMany/deleteMany
 * e em `data` de create/createMany/upsert. Modelos sem tenantId (Session, BatchItem, WaAuthKey)
 * passam direto — são alcançados via relações já escopadas.
 *
 * Atenção: `findUnique`/`update`/`delete` por chave única NÃO são filtrados (o Prisma não aceita
 * campos extras no where único). Sempre localize com `findFirst` escopado antes de mutar por id.
 */
export function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args as {
            where?: Record<string, unknown>;
            data?: Record<string, unknown> | Record<string, unknown>[];
            create?: Record<string, unknown>;
          };
          if (FILTERED_OPS.has(operation)) a.where = { ...(a.where ?? {}), tenantId };
          if (operation === 'create' && a.data && !Array.isArray(a.data)) a.data = { ...a.data, tenantId };
          if (operation === 'createMany' && Array.isArray(a.data)) {
            a.data = a.data.map((d) => ({ ...d, tenantId }));
          }
          if (operation === 'upsert' && a.create) a.create = { ...a.create, tenantId };
          return query(args);
        },
      },
    },
  });
}
export type TenantClient = ReturnType<typeof forTenant>;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/db test`
Expected: 3 PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): schema Prisma da F1 (com tabelas futuras), migration inicial e forTenant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `db` — criptografia de credenciais e seed

**Files:**
- Create: `packages/db/src/crypto.ts`, `packages/db/prisma/seed.ts`
- Modify: `packages/db/src/index.ts` (export)
- Test: `packages/db/test/crypto.test.ts`

**Interfaces:**
- Produces:
  - `encryptJson(value: unknown, key?: string): Buffer` / `decryptJson<T>(buf: Buffer, key?: string): T` — AES-256-GCM, formato `iv(12) | tag(16) | ciphertext`; `key` default `process.env.APP_ENCRYPTION_KEY` (hex 64 chars).
  - Seed cria: tenant `default`, usuário OWNER (`SEED_USER_EMAIL`/`SEED_USER_PASSWORD`, hash argon2), `OperatingWindow` padrão, `Template` padrão `isDefault`, `Setting`s `queueLimit=500`, `globalRateLimitPerMin=6`, `subIdPattern="{yyyyMMdd}-{batchId}"`.

- [ ] **Step 1: Teste — `test/crypto.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson } from '../src/crypto';

const key = 'a'.repeat(64);

describe('crypto', () => {
  it('round-trip', () => {
    const buf = encryptJson({ appId: '1', secret: 's3' }, key);
    expect(decryptJson(buf, key)).toEqual({ appId: '1', secret: 's3' });
  });
  it('mesmo payload gera cifras diferentes (IV aleatório)', () => {
    expect(encryptJson('x', key).equals(encryptJson('x', key))).toBe(false);
  });
  it('chave errada falha', () => {
    const buf = encryptJson('x', key);
    expect(() => decryptJson(buf, 'b'.repeat(64))).toThrow();
  });
  it('chave inválida é rejeitada', () => {
    expect(() => encryptJson('x', 'curta')).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/db test -- crypto`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(key?: string): Buffer {
  const hex = key ?? process.env.APP_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('APP_ENCRYPTION_KEY deve ter 64 caracteres hex (openssl rand -hex 32)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptJson(value: unknown, key?: string): Buffer {
  const k = loadKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptJson<T = unknown>(buf: Buffer, key?: string): T {
  const k = loadKey(key);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}
```

Adicionar em `src/index.ts`: `export * from './crypto';`

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/db test -- crypto`
Expected: 4 PASS.

- [ ] **Step 5: Implementar `prisma/seed.ts`**

```ts
import { hash } from '@node-rs/argon2';
import { prisma } from '../src/index';

const DEFAULT_TEMPLATE = `🔥 *{titulo}*

{#preco_antigo}~De {preco_antigo}~{/preco_antigo}
💰 *Por {preco}* {desconto}
{#frete_gratis}{frete_gratis}{/frete_gratis}
{#cupom}🎟️ Cupom: *{cupom}*{/cupom}
{#oferta_relampago}{oferta_relampago}{/oferta_relampago}

👉 {link}`;

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) throw new Error('Defina SEED_USER_EMAIL e SEED_USER_PASSWORD');

  const tenant =
    (await prisma.tenant.findFirst({ where: { name: 'default' } })) ??
    (await prisma.tenant.create({ data: { name: 'default' } }));

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { tenantId: tenant.id, email, name: 'Admin', role: 'OWNER', passwordHash: await hash(password) },
  });

  await prisma.operatingWindow.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id },
  });

  const hasDefault = await prisma.template.findFirst({ where: { tenantId: tenant.id, isDefault: true } });
  if (!hasDefault) {
    await prisma.template.create({
      data: { tenantId: tenant.id, name: 'Padrão', body: DEFAULT_TEMPLATE, isDefault: true },
    });
  }

  const settings: Record<string, unknown> = {
    queueLimit: 500,
    globalRateLimitPerMin: 6,
    subIdPattern: '{yyyyMMdd}-{batchId}',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: {},
      create: { tenantId: tenant.id, key, value: value as object },
    });
  }
  console.log(`Seed ok: tenant=${tenant.id} user=${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Rodar o seed duas vezes (idempotência)**

Run: `cp -n .env.example .env; set -a && . ./.env && set +a && pnpm db:seed && pnpm db:seed`
Expected: duas linhas `Seed ok: ...` sem erro. Verificar: `docker compose exec postgres psql -U afilados -c 'select count(*) from "User"'` → `1`.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): criptografia AES-256-GCM de credenciais e seed idempotente

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `@afilados/marketplaces` — interface e assinatura Shopee

**Files:**
- Create: `packages/marketplaces/package.json`, `packages/marketplaces/tsconfig.json`, `packages/marketplaces/vitest.config.ts`
- Create: `packages/marketplaces/src/{index,adapter}.ts`, `packages/marketplaces/src/shopee/signature.ts`
- Test: `packages/marketplaces/test/shopee.signature.test.ts`

**Interfaces:**
- Produces:
  - `adapter.ts`:
    ```ts
    export interface ConnectionStatus { ok: boolean; error?: string }
    export interface ShopeeCredentials { appId: string; secret: string }
    export interface MarketplaceAdapter<C = unknown> {
      readonly kind: MarketplaceKind;
      checkConnection(creds: C): Promise<ConnectionStatus>;
      search?(creds: C, query: SearchQuery): Promise<ProductData[]>;
      fetchByUrls(creds: C, urls: string[]): Promise<ProductData[]>;
      toAffiliateLink(creds: C, url: string, subId?: string): Promise<string>;
    }
    ```
  - `shopee/signature.ts`: `buildShopeeAuthHeader(appId, secret, payload: string, timestamp: number): string` → `SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<hex>` onde `Signature = sha256(appId + timestamp + payload + secret)`.

- [ ] **Step 1: Arquivos de pacote**

`packages/marketplaces/package.json`:
```json
{
  "name": "@afilados/marketplaces",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@afilados/shared": "workspace:*", "@afilados/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

`packages/marketplaces/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/marketplaces/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 2: Teste — `test/shopee.signature.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildShopeeAuthHeader } from '../src/shopee/signature';

describe('buildShopeeAuthHeader', () => {
  it('monta header no formato da Open Platform', () => {
    const payload = '{"query":"{ x }"}';
    const ts = 1700000000;
    const expected = createHash('sha256').update(`app${ts}${payload}sec`).digest('hex');
    expect(buildShopeeAuthHeader('app', 'sec', payload, ts)).toBe(
      `SHA256 Credential=app, Timestamp=${ts}, Signature=${expected}`,
    );
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `pnpm install && pnpm --filter @afilados/marketplaces test`
Expected: FAIL.

- [ ] **Step 4: Implementar**

`src/adapter.ts`:
```ts
import type { MarketplaceKind, ProductData, SearchQuery } from '@afilados/shared';

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
}

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

export interface MarketplaceAdapter<C = unknown> {
  readonly kind: MarketplaceKind;
  checkConnection(creds: C): Promise<ConnectionStatus>;
  /** Só marketplaces com API de busca (Shopee). */
  search?(creds: C, query: SearchQuery): Promise<ProductData[]>;
  fetchByUrls(creds: C, urls: string[]): Promise<ProductData[]>;
  toAffiliateLink(creds: C, url: string, subId?: string): Promise<string>;
}
```

`src/shopee/signature.ts`:
```ts
import { createHash } from 'node:crypto';

export function buildShopeeAuthHeader(
  appId: string,
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const signature = createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}
```

`src/index.ts`:
```ts
export * from './adapter';
export * from './shopee/signature';
```

- [ ] **Step 5: Rodar e ver passar; commit**

Run: `pnpm --filter @afilados/marketplaces test`
Expected: 1 PASS.

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): interface MarketplaceAdapter e assinatura da Shopee Open Platform

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Adapter Shopee — client GraphQL, mapper e modo mock

**Files:**
- Create: `packages/marketplaces/src/shopee/{client,mapper,adapter}.ts`
- Create: `packages/marketplaces/src/shopee/fixtures/productOfferV2.json`, `packages/marketplaces/src/shopee/fixtures/generateShortLink.json`
- Modify: `packages/marketplaces/src/index.ts`
- Test: `packages/marketplaces/test/shopee.mapper.test.ts`, `packages/marketplaces/test/shopee.adapter.test.ts`

**Interfaces:**
- Consumes: `buildShopeeAuthHeader` (T9), `parseProductUrl` (core, T6), `productDataSchema` (shared, T2).
- Produces:
  - `ShopeeGraphQLClient` com `constructor(creds, fetchImpl = fetch)` e `request<T>(query: string, variables: object): Promise<T>`; endpoint `https://open-api.affiliate.shopee.com.br/graphql`; `ShopeeApiError`.
  - `mapProductOffer(node: ShopeeProductOfferNode): ProductData`.
  - `createShopeeAdapter(opts: { mock?: boolean; fetchImpl?: typeof fetch }): MarketplaceAdapter<ShopeeCredentials>`.

> Os nomes de campos GraphQL abaixo seguem a documentação pública da Shopee Affiliate Open Platform (`productOfferV2`, `generateShortLink`). Se a API real divergir, ajuste o mapper e regrave as fixtures com uma resposta real — os testes de mapper são o contrato.

- [ ] **Step 1: Fixtures**

`src/shopee/fixtures/productOfferV2.json`:
```json
{
  "data": {
    "productOfferV2": {
      "nodes": [
        {
          "itemId": 987654,
          "shopId": 123456,
          "productName": "Processador AMD Ryzen 5 5500",
          "priceMin": "848.48",
          "priceMax": "848.48",
          "priceDiscountRate": 29,
          "sales": 6,
          "commissionRate": "0.03",
          "imageUrl": "https://cf.shopee.com.br/file/abc",
          "shopName": "Loja Oficial AMD",
          "shopType": [1],
          "productLink": "https://shopee.com.br/product/123456/987654",
          "offerLink": "https://s.shopee.com.br/xyz",
          "periodStartTime": 0,
          "periodEndTime": 0
        },
        {
          "itemId": 111,
          "shopId": 222,
          "productName": "Kit Upgrade",
          "priceMin": "2029.90",
          "priceMax": "2100.00",
          "priceDiscountRate": 0,
          "sales": 1,
          "commissionRate": "0.05",
          "imageUrl": "https://cf.shopee.com.br/file/def",
          "shopName": "Loja X",
          "shopType": [],
          "productLink": "https://shopee.com.br/product/222/111",
          "offerLink": "https://s.shopee.com.br/uvw",
          "periodStartTime": 0,
          "periodEndTime": 1789000000
        }
      ],
      "pageInfo": { "page": 1, "limit": 50, "hasNextPage": false }
    }
  }
}
```

`src/shopee/fixtures/generateShortLink.json`:
```json
{ "data": { "generateShortLink": { "shortLink": "https://s.shopee.com.br/MOCK123" } } }
```

- [ ] **Step 2: Teste do mapper — `test/shopee.mapper.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import fixture from '../src/shopee/fixtures/productOfferV2.json';
import { mapProductOffer } from '../src/shopee/mapper';

const nodes = fixture.data.productOfferV2.nodes;

describe('mapProductOffer', () => {
  it('mapeia campos principais', () => {
    const p = mapProductOffer(nodes[0]!);
    expect(p).toMatchObject({
      source: 'SHOPEE',
      externalId: '987654',
      shopId: '123456',
      title: 'Processador AMD Ryzen 5 5500',
      price: 848.48,
      discountPct: 29,
      salesCount: 6,
      commissionPct: 3,
      images: ['https://cf.shopee.com.br/file/abc'],
      originalUrl: 'https://shopee.com.br/product/123456/987654',
      shopName: 'Loja Oficial AMD',
    });
    expect(p.originalPrice).toBeCloseTo(1194.99, 1);
    expect(p.flashSaleEndsAt).toBeUndefined();
  });
  it('sem desconto → sem originalPrice; periodEndTime vira flashSaleEndsAt', () => {
    const p = mapProductOffer(nodes[1]!);
    expect(p.originalPrice).toBeUndefined();
    expect(p.discountPct).toBeUndefined();
    expect(p.flashSaleEndsAt).toBe(new Date(1789000000 * 1000).toISOString());
  });
});
```

- [ ] **Step 3: Teste do adapter — `test/shopee.adapter.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createShopeeAdapter } from '../src/shopee/adapter';
import offers from '../src/shopee/fixtures/productOfferV2.json';
import short from '../src/shopee/fixtures/generateShortLink.json';

const creds = { appId: 'app', secret: 'sec' };

function fakeFetch(bodies: unknown[]) {
  const queue = [...bodies];
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const body = queue.shift();
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

const baseQuery = {
  source: 'SHOPEE' as const,
  mode: 'keyword' as const,
  query: 'ryzen',
  sort: 'DISCOUNT_DESC' as const,
  limit: 100,
  topSellers: false,
  extraCommission: false,
};

describe('ShopeeAdapter (mock)', () => {
  const adapter = createShopeeAdapter({ mock: true });
  it('search devolve fixtures', async () => {
    const r = await adapter.search!(creds, baseQuery);
    expect(r).toHaveLength(2);
    expect(r[0]!.source).toBe('SHOPEE');
  });
  it('toAffiliateLink devolve link mock', async () => {
    expect(await adapter.toAffiliateLink(creds, 'https://shopee.com.br/product/1/2', 'sub')).toBe(
      'https://s.shopee.com.br/MOCK123',
    );
  });
  it('checkConnection ok', async () => {
    expect(await adapter.checkConnection(creds)).toEqual({ ok: true });
  });
});

describe('ShopeeAdapter (real, fetch falso)', () => {
  it('search envia header assinado e variáveis corretas', async () => {
    const f = fakeFetch([offers]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const r = await adapter.search!(creds, { ...baseQuery, sort: 'COMMISSION_DESC', limit: 10, topSellers: true });
    expect(r).toHaveLength(2);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^SHA256 Credential=app, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
    const body = JSON.parse(init!.body as string) as { variables: Record<string, unknown> };
    expect(body.variables).toMatchObject({ keyword: 'ryzen', sortType: 3, limit: 10, isOfficialShop: true });
  });
  it('fetchByUrls resolve itemId da URL', async () => {
    const f = fakeFetch([offers]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const r = await adapter.fetchByUrls(creds, ['https://shopee.com.br/x-i.123456.987654']);
    expect(r[0]!.externalId).toBe('987654');
  });
  it('toAffiliateLink usa generateShortLink', async () => {
    const f = fakeFetch([short]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    expect(await adapter.toAffiliateLink(creds, 'https://shopee.com.br/product/1/2', 's1')).toBe(
      'https://s.shopee.com.br/MOCK123',
    );
  });
  it('erro GraphQL vira status legível', async () => {
    const f = fakeFetch([{ errors: [{ message: 'invalid signature' }] }]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    await expect(adapter.checkConnection(creds)).resolves.toEqual({ ok: false, error: 'invalid signature' });
  });
});
```

- [ ] **Step 4: Rodar para ver falhar**

Run: `pnpm --filter @afilados/marketplaces test`
Expected: FAIL nos dois arquivos novos.

- [ ] **Step 5: Implementar `src/shopee/client.ts`**

```ts
import { buildShopeeAuthHeader } from './signature';
import type { ShopeeCredentials } from '../adapter';

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

export class ShopeeApiError extends Error {}

export class ShopeeGraphQLClient {
  constructor(
    private readonly creds: ShopeeCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await this.fetchImpl(SHOPEE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildShopeeAuthHeader(this.creds.appId, this.creds.secret, payload, timestamp),
      },
      body: payload,
    });
    if (!res.ok) throw new ShopeeApiError(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new ShopeeApiError(json.errors.map((e) => e.message).join('; '));
    if (!json.data) throw new ShopeeApiError('Resposta sem data');
    return json.data;
  }
}
```

- [ ] **Step 6: Implementar `src/shopee/mapper.ts`**

```ts
import { productDataSchema, type ProductData } from '@afilados/shared';

export interface ShopeeProductOfferNode {
  itemId: number;
  shopId: number;
  productName: string;
  priceMin: string;
  priceMax: string;
  priceDiscountRate: number;
  sales: number;
  commissionRate: string;
  imageUrl: string;
  shopName: string;
  shopType: number[];
  productLink: string;
  offerLink: string;
  periodStartTime: number;
  periodEndTime: number;
}

export function mapProductOffer(n: ShopeeProductOfferNode): ProductData {
  const price = Number(n.priceMin);
  const discount = n.priceDiscountRate > 0 ? n.priceDiscountRate : undefined;
  const originalPrice = discount ? Number((price / (1 - discount / 100)).toFixed(2)) : undefined;
  const commissionPct = Number((Number(n.commissionRate) * 100).toFixed(2));
  const flashSaleEndsAt = n.periodEndTime > 0 ? new Date(n.periodEndTime * 1000).toISOString() : undefined;
  const data: Record<string, unknown> = {
    source: 'SHOPEE',
    externalId: String(n.itemId),
    shopId: String(n.shopId),
    shopName: n.shopName,
    title: n.productName,
    price,
    commissionPct,
    salesCount: n.sales,
    images: n.imageUrl ? [n.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: n.productLink,
    raw: n,
  };
  if (discount !== undefined) data.discountPct = discount;
  if (originalPrice !== undefined) data.originalPrice = originalPrice;
  if (flashSaleEndsAt !== undefined) data.flashSaleEndsAt = flashSaleEndsAt;
  return productDataSchema.parse(data);
}
```

- [ ] **Step 7: Implementar `src/shopee/adapter.ts`**

```ts
import { parseProductUrl } from '@afilados/core';
import type { ProductData, SearchQuery, SearchSort } from '@afilados/shared';
import type { MarketplaceAdapter, ShopeeCredentials, ConnectionStatus } from '../adapter';
import { ShopeeGraphQLClient } from './client';
import { mapProductOffer, type ShopeeProductOfferNode } from './mapper';
import offersFixture from './fixtures/productOfferV2.json';
import shortLinkFixture from './fixtures/generateShortLink.json';

// sortType da Open Platform: 1 = relevância, 2 = mais vendidos, 3 = maior comissão,
// 4 = preço asc, 5 = preço desc, 6 = maior desconto
const SORT_MAP: Record<SearchSort, number> = {
  SALES_DESC: 2,
  COMMISSION_DESC: 3,
  PRICE_ASC: 4,
  PRICE_DESC: 5,
  DISCOUNT_DESC: 6,
};

const PRODUCT_OFFER_QUERY = `
query ProductOffer($keyword: String, $productCatId: Int, $shopId: Int, $itemId: Int64, $listType: Int,
  $sortType: Int, $page: Int, $limit: Int, $isOfficialShop: Boolean, $isKeySeller: Boolean) {
  productOfferV2(keyword: $keyword, productCatId: $productCatId, shopId: $shopId, itemId: $itemId,
    listType: $listType, sortType: $sortType, page: $page, limit: $limit,
    isOfficialShop: $isOfficialShop, isKeySeller: $isKeySeller) {
    nodes { itemId shopId productName priceMin priceMax priceDiscountRate sales commissionRate
      imageUrl shopName shopType productLink offerLink periodStartTime periodEndTime }
    pageInfo { page limit hasNextPage }
  }
}`;

const SHORT_LINK_MUTATION = `
mutation ShortLink($originUrl: String!, $subIds: [String]) {
  generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) { shortLink }
}`;

interface OfferResponse {
  productOfferV2: { nodes: ShopeeProductOfferNode[]; pageInfo: { hasNextPage: boolean } };
}
interface ShortLinkResponse {
  generateShortLink: { shortLink: string };
}

export interface ShopeeAdapterOptions {
  mock?: boolean;
  fetchImpl?: typeof fetch;
}

export function createShopeeAdapter(opts: ShopeeAdapterOptions = {}): MarketplaceAdapter<ShopeeCredentials> {
  const mock = opts.mock ?? process.env.SHOPEE_MOCK === '1';
  const client = (creds: ShopeeCredentials) => new ShopeeGraphQLClient(creds, opts.fetchImpl);

  async function searchPage(creds: ShopeeCredentials, vars: Record<string, unknown>): Promise<OfferResponse> {
    if (mock) return offersFixture.data as unknown as OfferResponse;
    return client(creds).request<OfferResponse>(PRODUCT_OFFER_QUERY, vars);
  }

  return {
    kind: 'SHOPEE',

    async checkConnection(creds): Promise<ConnectionStatus> {
      try {
        await searchPage(creds, { limit: 1, page: 1 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async search(creds, q: SearchQuery): Promise<ProductData[]> {
      const vars: Record<string, unknown> = {
        sortType: SORT_MAP[q.sort],
        limit: Math.min(q.limit, 50),
        page: 1,
      };
      if (q.mode === 'keyword') vars.keyword = q.query;
      if (q.mode === 'category') vars.productCatId = Number(q.categoryId);
      if (q.mode === 'shop') vars.shopId = Number(q.shopId);
      if (q.mode === 'trending') vars.listType = 2;
      if (q.topSellers) {
        vars.isOfficialShop = true;
        vars.isKeySeller = true;
      }
      const out: ProductData[] = [];
      let page = 1;
      while (out.length < q.limit) {
        const res = await searchPage(creds, { ...vars, page });
        const nodes = res.productOfferV2.nodes.map(mapProductOffer);
        out.push(...nodes);
        if (!res.productOfferV2.pageInfo.hasNextPage || nodes.length === 0 || mock) break;
        page++;
      }
      const filtered = q.extraCommission ? out.filter((p) => (p.commissionPct ?? 0) > 3) : out;
      return filtered.slice(0, q.limit);
    },

    async fetchByUrls(creds, urls): Promise<ProductData[]> {
      const out: ProductData[] = [];
      for (const url of urls) {
        const parsed = parseProductUrl(url);
        if (parsed.source !== 'SHOPEE') continue;
        const res = await searchPage(creds, { itemId: Number(parsed.externalId), limit: 1, page: 1 });
        const node =
          res.productOfferV2.nodes.find((n) => String(n.itemId) === parsed.externalId) ??
          res.productOfferV2.nodes[0];
        if (node) out.push(mapProductOffer(node));
      }
      return out;
    },

    async toAffiliateLink(creds, url, subId): Promise<string> {
      if (mock) return shortLinkFixture.data.generateShortLink.shortLink;
      const res = await client(creds).request<ShortLinkResponse>(SHORT_LINK_MUTATION, {
        originUrl: url,
        subIds: subId ? [subId] : [],
      });
      return res.generateShortLink.shortLink;
    },
  };
}
```

`src/index.ts` passa a ser:
```ts
export * from './adapter';
export * from './shopee/signature';
export * from './shopee/client';
export * from './shopee/mapper';
export * from './shopee/adapter';
```

- [ ] **Step 8: Rodar e ver passar; typecheck**

Run: `pnpm --filter @afilados/marketplaces test && pnpm --filter @afilados/marketplaces typecheck`
Expected: mapper 2 PASS, adapter 7 PASS; typecheck limpo.

- [ ] **Step 9: Commit**

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): adapter Shopee (busca, fetch por URL, short link) com modo mock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Verificação final da F1-A e README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Rodar tudo na raiz**

Run: `pnpm typecheck && pnpm test`
Expected: todos os pacotes typecheck OK; Vitest reporta todos os arquivos PASS (shared 1 arquivo, core 6, db 2, marketplaces 3).

- [ ] **Step 2: Criar `README.md`**

````markdown
# Afilados

Automação de ofertas de afiliado para grupos de WhatsApp. Specs e planos em `docs/superpowers/`.

## Desenvolvimento

```bash
cp .env.example .env            # preencha APP_ENCRYPTION_KEY e SESSION_SECRET (openssl rand -hex 32)
echo "DATABASE_URL=postgresql://afilados:afilados@localhost:5432/afilados" > packages/db/.env
pnpm install
docker compose up -d
pnpm db:migrate
set -a && . ./.env && set +a && pnpm db:seed
pnpm test
```

## Pacotes

- `packages/shared` — tipos, enums, schemas Zod
- `packages/core` — regras de negócio puras (template, janela, agendamento, shuffle, URLs, SubID)
- `packages/db` — Prisma, `forTenant`, criptografia, seed
- `packages/marketplaces` — adapters (Shopee na F1; `SHOPEE_MOCK=1` para rodar sem credenciais)
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README com setup de desenvolvimento

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Cobertura do spec F1 §7 (core):** renderTemplate + flashSaleLabel (T3), janela (T4), scheduleBatch (T5), shuffle/parseProductUrl/generateSubId (T6) ✔.
- **§3 banco:** todas as tabelas F1 + reservadas (T7); `forTenant` (T7); seed com settings/template/janela (T8) ✔.
- **§6 Shopee:** checkConnection, search com todos os modos e filtros, fetchByUrls, toAffiliateLink com subId, mock (T10) ✔.
- **Fora deste plano (F1-B/F1-C):** API, worker, web, deploy prod — conforme divisão anunciada.
- **Consistência de tipos:** `ProductData` (T2) usado em T3/T10; `OperatingWindow` (T4) usado em T5; `ShopeeCredentials`/`MarketplaceAdapter` (T9) usados em T10; `parseProductUrl` retorna `externalId: string` usado em T10 ✔.
