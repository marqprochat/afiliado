# Link do site nas ofertas postadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda oferta de produto postada pelo tenant do dono da aplicação passa a levar o link da página do produto em `/ofertas/<slug>` (com comparativo, cupom e botão para o link de afiliado convertido), com fallback para o link de afiliado direto.

**Architecture:** O motor de preços sai de `apps/api/src/lib/price-engine.ts` para o novo pacote `@afilados/deals`, usado pela API e pelo worker; ele passa a gravar o `affiliateUrl` convertido e a devolver o `slug`. No worker, `publishOffer` indexa o produto (teto de 5 s) e devolve `${PUBLIC_SITE_URL}/ofertas/<slug>` quando a configuração `siteLinks` do tenant está ligada; os pontos de envio (template do WhatsApp, Telegram, texto livre, espelhamento) usam `siteUrl ?? affiliateLink`. A página pública ganha o bloco de cupom e a API anônima passa a servir o tenant do superadmin.

**Tech Stack:** pnpm monorepo, TypeScript, Fastify 5 + Prisma 5 (Postgres), BullMQ + Baileys 6.7.24, Next.js 15 + React Query, vitest 2 + testing-library.

## Global Constraints

- Fonte da verdade: `docs/superpowers/specs/2026-11-23-ofertas-link-do-site-design.md`. Nenhuma decisão dela muda aqui.
- Link publicado: `${PUBLIC_SITE_URL}/ofertas/${slug}`; em produção `PUBLIC_SITE_URL: https://${DOMAIN}` no serviço worker do `docker-compose.prod.yml`. `PUBLIC_SITE_URL` é opcional; sem ele, `publishOffer` devolve `null` e loga aviso uma vez por processo.
- Configuração: chave `siteLinks` em `Setting`, valor `{ enabled: boolean }`. Ausente = desligado. Editável só por quem não é afiliado (`forbidAffiliate`). Uma migração de dados liga a chave para o tenant do superadmin.
- Publicação nunca bloqueia envio: exceção ou tempo acima de 5 s → log `publish-offer fallback` com tenant/source/url e a mensagem sai com o link de afiliado.
- `ProductListing.affiliateUrl`: grava o link convertido no envio; sem link novo, preserva o existente; listagem nova sem link convertido usa `originalUrl`. Shopee/AliExpress ficam com o subId do último envio.
- Cupom na página: (1) `Product` mais recente com o mesmo `(source, externalId)` da melhor listagem e `couponCode` preenchido; senão (2) até 3 `Coupon` da mesma loja, `status = VALID`, `expiresAt` nulo ou futuro, por `discountValue` decrescente.
- Texto livre/CLONE: no máximo 5 URLs por mensagem; URL que não é de loja, loja sem fetcher (Awin) ou busca que falha mantém o link de afiliado. A prévia usa a primeira URL do texto já reescrito.
- Cupom enviado sozinho (`couponId`) não muda. Afiliados não são afetados (não têm `siteLinks`).
- Não mexer na versão do Baileys (fica em `6.7.24`).
- Testes que precisam de Postgres/Redis rodam no servidor Linux: `bash .superpowers/sdd/remote.sh run pnpm --filter <pkg> exec vitest run <arquivo>`. Testes puros rodam localmente com `pnpm --filter <pkg> exec vitest run <arquivo>`. Depois de criar pacote novo ou migração, rode `bash .superpowers/sdd/remote.sh setup` antes.
- Prosa e mensagens de log/UI em pt-BR; identificadores em inglês, como no resto do código.

---

## File Structure

**Novo pacote `packages/deals`** (motor de preços compartilhado)
- Create: `packages/deals/package.json`, `packages/deals/tsconfig.json`, `packages/deals/vitest.config.ts`
- Create: `packages/deals/src/index.ts` — reexporta o motor.
- Move: `apps/api/src/lib/price-engine.ts` → `packages/deals/src/price-engine.ts` — indexação (agora com `affiliateUrl` e `slug`), vitrine, detalhe (agora com `coupons`).
- Create: `packages/deals/test/price-engine.test.ts`

**Shared**
- Create: `packages/shared/src/site-links.ts` — `SITE_LINKS_KEY`, `siteLinksUpdateSchema`, `SiteLinksSetting`, `siteLinksEnabled()`.
- Modify: `packages/shared/src/index.ts` — exporta o arquivo acima.

**DB**
- Create: `packages/db/prisma/migrations/20261123120000_site_links_owner/migration.sql` — liga `siteLinks` para o superadmin.
- Create: `packages/db/test/site-links-migration.test.ts`

**API**
- Modify: `apps/api/src/routes/deals.ts` — import do `@afilados/deals`, `resolveTenantId` com superadmin primeiro.
- Modify: `apps/api/src/lib/products.ts` — import do `@afilados/deals`.
- Create: `apps/api/src/routes/site-links.ts` — `GET/PUT /settings/site-links`.
- Modify: `apps/api/src/app.ts` — registra a rota.
- Modify: `apps/api/package.json` — dependência `@afilados/deals`.
- Create: `apps/api/test/deals-coupons.test.ts`, `apps/api/test/deals-public-tenant.test.ts`, `apps/api/test/site-links.test.ts`

**Worker**
- Modify: `apps/worker/src/config.ts` — `PUBLIC_SITE_URL`.
- Create: `apps/worker/src/lib/publish-offer.ts` — `publishOffer`, `isSiteLinksEnabled`, `publishOfferForTenant`, `PublishOfferFn`.
- Create: `apps/worker/src/lib/rewrite-offer-links.ts` — `rewriteOfferLinks`, `rewriteOfferLinksForTenant`, `RewriteOfferLinksFn`.
- Modify: `apps/worker/src/processors/send-offer.ts`, `send-telegram.ts`, `mirror-message.ts`
- Modify: `apps/worker/package.json` — dependência `@afilados/deals`.
- Create: `apps/worker/test/publish-offer.test.ts`, `apps/worker/test/rewrite-offer-links.test.ts`, `apps/worker/test/send-telegram-site-links.test.ts`, `apps/worker/test/mirror-site-links.test.ts`
- Modify: `apps/worker/test/send-offer.test.ts`

**Web**
- Create: `apps/web/src/components/deals/deal-coupon-block.tsx` — bloco "Cupom disponível".
- Modify: `apps/web/src/app/ofertas/[slug]/page.tsx` — renderiza o bloco.
- Create: `apps/web/src/components/settings/site-links-toggle.tsx` — chave liga/desliga.
- Modify: `apps/web/src/app/(app)/config/conta/page.tsx`, `apps/web/src/lib/queries.ts`, `apps/web/src/lib/types.ts`
- Create: `apps/web/test/deal-coupon-block.test.tsx`, `apps/web/test/conta-page.test.tsx`

**Deploy / scripts**
- Modify: `deploy/Dockerfile.api`, `deploy/Dockerfile.worker` — copiam `packages/deals/package.json` antes do `pnpm install`.
- Modify: `docker-compose.prod.yml` — `PUBLIC_SITE_URL` no worker.
- Modify: `.env.example` — documenta `PUBLIC_SITE_URL`.
- Modify: `scripts/seed-deals-demo.ts` — import do novo caminho.

Ajuste em relação à ordem sugerida: o `PUBLIC_SITE_URL` do `docker-compose.prod.yml` entra na Task 5 junto com a config do worker (a mudança só faz sentido com ela); o espelhamento ganhou uma task própria (Task 8), separada do texto livre do `send-offer` (Task 7), porque um revisor pode aprovar uma e rejeitar a outra.

---

### Task 1: Pacote `@afilados/deals` com `affiliateUrl` preservado e `slug` no retorno

**Files:**
- Create: `packages/deals/package.json`, `packages/deals/tsconfig.json`, `packages/deals/vitest.config.ts`, `packages/deals/src/index.ts`
- Move: `apps/api/src/lib/price-engine.ts` → `packages/deals/src/price-engine.ts` (edits em `:58-62`, `:183-198`, `:200-217`, `:253-276`)
- Modify: `apps/api/src/routes/deals.ts:5`, `apps/api/src/lib/products.ts:4`, `scripts/seed-deals-demo.ts:3`
- Modify: `apps/api/package.json`, `apps/worker/package.json`, `deploy/Dockerfile.api`, `deploy/Dockerfile.worker`, `pnpm-lock.yaml`
- Test: `packages/deals/test/price-engine.test.ts`

**Interfaces:**
- Consumes: `TenantClient` (`@afilados/db`), `ProductData` (`@afilados/shared`), `normalizeProductTitle`, `findBestProductMatch`, `analyzeDealPromotion` (`@afilados/core`).
- Produces:
  - `interface IndexProductOptions { affiliateUrl?: string }`
  - `interface IndexProductResult { masterProductId: string; slug: string; isNewMaster: boolean; isPriceDrop: boolean }`
  - `indexProductInPriceEngine(db: TenantClient, tenantId: string, item: ProductData, opts?: IndexProductOptions): Promise<IndexProductResult>`
  - `getDealsShowcase`, `getDealDetailBySlug`, `syncDealsCatalog`, `checkAndNotifyPriceAlerts` exportados de `@afilados/deals` (mesmas assinaturas de hoje).

- [ ] **Step 1: Criar o pacote e mover o arquivo**

```bash
mkdir -p packages/deals/src packages/deals/test
git mv apps/api/src/lib/price-engine.ts packages/deals/src/price-engine.ts
```

`packages/deals/package.json`:

```json
{
  "name": "@afilados/deals",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@afilados/core": "workspace:*",
    "@afilados/db": "workspace:*",
    "@afilados/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

`packages/deals/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/deals/vitest.config.ts` (igual ao de `packages/db`: sem `env`, o `DATABASE_URL` vem do contêiner remoto):

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 30_000 },
});
```

`packages/deals/src/index.ts`:

```ts
export * from './price-engine';
```

- [ ] **Step 2: Apontar API, worker e script para o pacote**

Em `apps/api/package.json` e `apps/worker/package.json`, dentro de `dependencies`, logo após `"@afilados/db": "workspace:*",`:

```json
    "@afilados/deals": "workspace:*",
```

`apps/api/src/routes/deals.ts:5`:

```ts
import { getDealsShowcase, getDealDetailBySlug, syncDealsCatalog } from '@afilados/deals';
```

`apps/api/src/lib/products.ts:4`:

```ts
import { indexProductInPriceEngine } from '@afilados/deals';
```

`scripts/seed-deals-demo.ts:3` (o script roda da raiz, que não tem o pacote como dependência):

```ts
import { indexProductInPriceEngine } from '../packages/deals/src/price-engine';
```

Em `deploy/Dockerfile.api` e `deploy/Dockerfile.worker`, logo após a linha `COPY packages/telegram/package.json packages/telegram/`:

```dockerfile
COPY packages/deals/package.json packages/deals/
```

Atualize o lockfile e o servidor de testes:

```bash
pnpm install
bash .superpowers/sdd/remote.sh setup
```

Expected: `pnpm-lock.yaml` ganha a entrada `packages/deals`; o `setup` termina sem erro.

- [ ] **Step 3: Escrever o teste que falha**

`packages/deals/test/price-engine.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import type { ProductData } from '@afilados/shared';
import { indexProductInPriceEngine } from '../src/index';

let tenantId: string;

const fone: ProductData = {
  source: 'SHOPEE',
  externalId: 'pe-1',
  title: 'Fone Bluetooth Motor Preco Teste',
  price: 100,
  images: ['https://img.test/fone.jpg'],
  shipping: 'UNKNOWN',
  originalUrl: 'https://shopee.com.br/product/1/111',
  raw: {},
};

const listingOf = (externalId: string) =>
  prisma.productListing.findFirstOrThrow({ where: { tenantId, source: 'SHOPEE', externalId } });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'deals-engine' } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('indexProductInPriceEngine', () => {
  let firstSlug: string;

  it('grava o link de afiliado informado e devolve o slug do produto canônico', async () => {
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, fone, {
      affiliateUrl: 'https://s.shopee.com.br/AFF1',
    });
    const master = await prisma.masterProduct.findFirstOrThrow({
      where: { id: r.masterProductId },
    });
    expect(r.slug).toBe(master.slug);
    expect((await listingOf('pe-1')).affiliateUrl).toBe('https://s.shopee.com.br/AFF1');
    firstSlug = r.slug;
  });

  it('sem link novo, preserva o link gravado e devolve o slug do canônico existente', async () => {
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, {
      ...fone,
      price: 90,
    });
    const listing = await listingOf('pe-1');
    expect(listing.affiliateUrl).toBe('https://s.shopee.com.br/AFF1');
    expect(Number(listing.currentPrice)).toBe(90);
    expect(r.slug).toBe(firstSlug);
  });

  it('com link novo, substitui o link gravado', async () => {
    await indexProductInPriceEngine(forTenant(tenantId), tenantId, fone, {
      affiliateUrl: 'https://s.shopee.com.br/AFF2',
    });
    expect((await listingOf('pe-1')).affiliateUrl).toBe('https://s.shopee.com.br/AFF2');
  });

  it('listagem nova sem link convertido usa o originalUrl', async () => {
    const panela: ProductData = {
      ...fone,
      externalId: 'pe-2',
      title: 'Panela Eletrica Arroz Totalmente Diferente',
      originalUrl: 'https://shopee.com.br/product/1/222',
    };
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, panela);
    expect((await listingOf('pe-2')).affiliateUrl).toBe(panela.originalUrl);
    expect(r.slug.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/deals exec vitest run test/price-engine.test.ts`
Expected: FAIL — `r.slug` é `undefined` no primeiro teste e o segundo vê `affiliateUrl` sobrescrito por `https://shopee.com.br/product/1/111`.

- [ ] **Step 5: Implementar no motor**

Em `packages/deals/src/price-engine.ts`, troque a assinatura (linhas 53-62) por:

```ts
export interface IndexProductOptions {
  /** Link de afiliado convertido no envio. Sem ele, a listagem mantém o link já gravado. */
  affiliateUrl?: string;
}

export interface IndexProductResult {
  masterProductId: string;
  slug: string;
  isNewMaster: boolean;
  isPriceDrop: boolean;
}

/**
 * Registra ou atualiza um produto no PriceEngine:
 * deduplica produtos idênticos entre marketplaces, alimenta o histórico de preços
 * e dispara alertas cadastrados se o preço bateu o valor desejado.
 */
export async function indexProductInPriceEngine(
  db: TenantClient,
  tenantId: string,
  item: ProductData,
  opts: IndexProductOptions = {},
): Promise<IndexProductResult> {
```

No `updateMany` da listagem existente, troque `affiliateUrl: item.originalUrl,` por:

```ts
        affiliateUrl: opts.affiliateUrl ?? existingListing.affiliateUrl ?? item.originalUrl,
```

No `create` da listagem nova, troque `affiliateUrl: item.originalUrl,` por:

```ts
        affiliateUrl: opts.affiliateUrl ?? item.originalUrl,
```

Troque o bloco do `currentMaster` até o `return` (linhas 253-276) por:

```ts
  const currentMaster = await db.masterProduct.findFirst({
    where: { id: masterId },
    select: { lowestPriceEver: true, slug: true },
  });
  if (!currentMaster) throw new Error(`MasterProduct ${masterId} não encontrado após indexar`);

  const prevLowest = Number(currentMaster.lowestPriceEver);
  const newLowestEver = Math.min(prevLowest, bestPrice);

  await db.masterProduct.updateMany({
    where: { id: masterId },
    data: {
      currentBestPrice: bestPrice,
      lowestPriceEver: newLowestEver,
      averagePrice30d: avg30d,
      bestListingId: bestListing ? bestListing.id : listingId,
      listingsCount: allListings.length,
      updatedAt: new Date(),
    },
  });

  // 5. Verifica e processa alertas cadastrados
  await checkAndNotifyPriceAlerts(db, masterId, bestPrice);

  return { masterProductId: masterId, slug: currentMaster.slug, isNewMaster, isPriceDrop };
}
```

- [ ] **Step 6: Rodar os testes e o typecheck**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/deals exec vitest run test/price-engine.test.ts`
Expected: PASS (4 testes).

Run: `pnpm --filter @afilados/deals typecheck && pnpm --filter @afilados/api typecheck && pnpm --filter @afilados/worker typecheck`
Expected: sem erros.

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/deals-detail.test.ts test/products.test.ts`
Expected: PASS (a API continua funcionando com o import novo).

- [ ] **Step 7: Commit**

```bash
git add packages/deals apps/api/src/routes/deals.ts apps/api/src/lib/products.ts apps/api/package.json apps/worker/package.json scripts/seed-deals-demo.ts deploy/Dockerfile.api deploy/Dockerfile.worker pnpm-lock.yaml
git commit -m "refactor(deals): extrair o motor de preços para @afilados/deals e preservar o link de afiliado"
```

---

### Task 2: Cupons no detalhe da oferta e tenant do superadmin na API pública

**Files:**
- Modify: `packages/deals/src/price-engine.ts` (função `getDealDetailBySlug`, hoje em `:513-581`)
- Modify: `apps/api/src/routes/deals.ts:33-63` (`resolveTenantId`)
- Test: `apps/api/test/deals-coupons.test.ts`, `apps/api/test/deals-public-tenant.test.ts`

**Interfaces:**
- Consumes: `getDealDetailBySlug(db, slug)` da Task 1; `formatBRL` (`@afilados/core`); `MARKETPLACE_KINDS`, `MarketplaceKind` (`@afilados/shared`).
- Produces:
  - `interface DealCoupon { code: string; description: string; discountLabel: string | null; expiresAt: Date | null }` exportado de `@afilados/deals`.
  - `getDealDetailBySlug` devolve também `coupons: DealCoupon[]` (no JSON da API `expiresAt` vira string ISO ou `null`).
  - `GET /api/v1/deals/:slug` anônimo usa o tenant do superadmin raiz (mais antigo) antes de qualquer outro fallback.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/test/deals-coupons.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let tenantId: string;
let cookie: string;
const future = new Date(Date.now() + 7 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

async function makeDeal(slug: string, source: 'SHOPEE' | 'AMAZON', externalId: string) {
  const master = await prisma.masterProduct.create({
    data: {
      tenantId,
      title: slug,
      cleanTitle: slug,
      slug,
      lowestPriceEver: 50,
      averagePrice30d: 50,
      currentBestPrice: 50,
    },
  });
  await prisma.productListing.create({
    data: {
      tenantId,
      masterProductId: master.id,
      source,
      storeName: source,
      externalId,
      title: slug,
      originalUrl: `https://loja.test/${externalId}`,
      affiliateUrl: `https://aff.test/${externalId}`,
      currentPrice: 50,
    },
  });
}

const getDeal = (slug: string) =>
  app.inject({ method: 'GET', url: `/api/v1/deals/${slug}`, headers: { cookie } });

beforeAll(async () => {
  const t = await createTenantWithUser('DealsCoupons');
  tenantId = t.tenantId;
  cookie = await loginCookie(app, t.email, t.password);
  await makeDeal('fone-com-cupom-0001', 'SHOPEE', 'sp-1');
  await makeDeal('fone-sem-cupom-0001', 'SHOPEE', 'sp-2');
  await makeDeal('livro-amazon-0001', 'AMAZON', 'B0LIVRO001');
  await prisma.product.create({
    data: {
      tenantId,
      source: 'SHOPEE',
      externalId: 'sp-1',
      title: 'Fone',
      price: 50,
      images: [],
      originalUrl: 'https://loja.test/sp-1',
      raw: {},
      couponCode: 'FONE10',
      couponValue: 10,
    },
  });
  await prisma.product.create({
    data: {
      tenantId,
      source: 'SHOPEE',
      externalId: 'sp-2',
      title: 'Fone 2',
      price: 50,
      images: [],
      originalUrl: 'https://loja.test/sp-2',
      raw: {},
    },
  });
  const coupon = (
    store: 'SHOPEE' | 'AMAZON',
    code: string,
    discountType: 'PERCENT' | 'FIXED',
    discountValue: number,
    status: 'VALID' | 'INVALID',
    expiresAt: Date | null,
  ) => ({ tenantId, store, code, description: `desc ${code}`, discountType, discountValue, status, expiresAt });
  await prisma.coupon.createMany({
    data: [
      coupon('SHOPEE', 'SHOP5', 'PERCENT', 5, 'VALID', future),
      coupon('SHOPEE', 'SHOP20', 'FIXED', 20, 'VALID', null),
      coupon('SHOPEE', 'SHOP15', 'PERCENT', 15, 'VALID', future),
      coupon('SHOPEE', 'SHOP1', 'PERCENT', 1, 'VALID', future),
      coupon('SHOPEE', 'VENCIDO', 'PERCENT', 90, 'VALID', past),
      coupon('SHOPEE', 'INVALIDO', 'PERCENT', 80, 'INVALID', future),
      coupon('AMAZON', 'AMZ10', 'PERCENT', 10, 'VALID', null),
    ],
  });
});

afterAll(async () => {
  await cleanupTenant(tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug — cupons', () => {
  it('devolve o cupom capturado com o produto da melhor listagem', async () => {
    const res = await getDeal('fone-com-cupom-0001');
    expect(res.statusCode).toBe(200);
    expect(res.json().coupons).toEqual([
      {
        code: 'FONE10',
        description: 'Cupom desta oferta',
        discountLabel: 'R$ 10,00 OFF',
        expiresAt: null,
      },
    ]);
  });

  it('sem cupom no produto, devolve até 3 cupons válidos da loja por desconto decrescente', async () => {
    const res = await getDeal('fone-sem-cupom-0001');
    expect(res.statusCode).toBe(200);
    const coupons = res.json().coupons as { code: string; discountLabel: string }[];
    expect(coupons.map((c) => c.code)).toEqual(['SHOP20', 'SHOP15', 'SHOP5']);
    expect(coupons[0]!.discountLabel).toBe('R$ 20,00 OFF');
    expect(coupons[1]!.discountLabel).toBe('15% OFF');
  });

  it('ignora expirados, inválidos e cupons de outra loja', async () => {
    const res = await getDeal('livro-amazon-0001');
    expect(res.json().coupons.map((c: { code: string }) => c.code)).toEqual(['AMZ10']);
  });
});
```

`apps/api/test/deals-public-tenant.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;

const master = (tenantId: string, slug: string) =>
  prisma.masterProduct.create({
    data: {
      tenantId,
      title: slug,
      cleanTitle: slug,
      slug,
      lowestPriceEver: 10,
      averagePrice30d: 10,
      currentBestPrice: 10,
    },
  });

beforeAll(async () => {
  // O tenant sem superadmin é criado ANTES: o fallback antigo ("primeiro tenant com MasterProduct")
  // tenderia a escolhê-lo.
  other = await createTenantWithUser('Outro com vitrine');
  await master(other.tenantId, 'produto-do-outro-0001');
  owner = await createTenantWithUser('Dono');
  await prisma.user.update({ where: { id: owner.userId }, data: { isSuperAdmin: true } });
  await master(owner.tenantId, 'produto-do-dono-0001');
});

afterAll(async () => {
  await cleanupTenant(other.tenantId);
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug anônimo', () => {
  it('serve as ofertas do tenant do superadmin', async () => {
    const others = await prisma.user.count({
      where: { isSuperAdmin: true, tenantId: { not: owner.tenantId } },
    });
    expect(others, 'há outro superadmin sobrando no banco de testes').toBe(0);

    const dono = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-dono-0001' });
    expect(dono.statusCode).toBe(200);
    const outro = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-outro-0001' });
    expect(outro.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/deals-coupons.test.ts test/deals-public-tenant.test.ts`
Expected: FAIL — `coupons` é `undefined`; a requisição anônima do produto do dono responde 404.

- [ ] **Step 3: Implementar os cupons no motor**

Em `packages/deals/src/price-engine.ts`, troque as linhas 3-10 (imports de `@afilados/shared` e `@afilados/core`) por:

```ts
import { MARKETPLACE_KINDS, type MarketplaceKind, type ProductData } from '@afilados/shared';
import {
  normalizeProductTitle,
  findBestProductMatch,
  analyzeDealPromotion,
  formatBRL,
  type DealAnalysis,
  type MatchingCandidate,
} from '@afilados/core';
```

Antes de `getDealDetailBySlug`, adicione:

```ts
export interface DealCoupon {
  code: string;
  description: string;
  discountLabel: string | null;
  expiresAt: Date | null;
}

const MAX_STORE_COUPONS = 3;

function couponDiscountLabel(
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null,
  value: unknown,
): string | null {
  if (type === 'FREE_SHIPPING') return 'Frete grátis';
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (type === 'PERCENT') return `${n}% OFF`;
  if (type === 'FIXED') return `${formatBRL(n)} OFF`;
  return null;
}

/**
 * Cupom da página da oferta: o capturado com o produto da melhor listagem; senão, até 3 cupons
 * válidos e não expirados da mesma loja, do maior desconto para o menor.
 */
async function findDealCoupons(
  db: TenantClient,
  listing: { source: string; externalId: string } | null,
): Promise<DealCoupon[]> {
  if (!listing) return [];
  const product = await db.product.findFirst({
    where: {
      source: listing.source as ProductData['source'],
      externalId: listing.externalId,
      couponCode: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { couponCode: true, couponValue: true },
  });
  if (product?.couponCode) {
    return [
      {
        code: product.couponCode,
        description: 'Cupom desta oferta',
        discountLabel:
          product.couponValue !== null ? `${formatBRL(Number(product.couponValue))} OFF` : null,
        expiresAt: null,
      },
    ];
  }
  if (!(MARKETPLACE_KINDS as readonly string[]).includes(listing.source)) return [];
  const rows = await db.coupon.findMany({
    where: {
      store: listing.source as MarketplaceKind,
      status: 'VALID',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { discountValue: { sort: 'desc', nulls: 'last' } },
    take: MAX_STORE_COUPONS,
    select: {
      code: true,
      description: true,
      discountType: true,
      discountValue: true,
      expiresAt: true,
    },
  });
  return rows.map((c) => ({
    code: c.code,
    description: c.description,
    discountLabel: couponDiscountLabel(c.discountType, c.discountValue),
    expiresAt: c.expiresAt,
  }));
}
```

Em `getDealDetailBySlug`, logo depois de `const analysis = analyzeDealPromotion(...);`:

```ts
  const coupons = await findDealCoupons(
    db,
    bestListing ? { source: bestListing.source, externalId: bestListing.externalId } : null,
  );
```

e no objeto devolvido, depois de `priceHistory: consolidatedHistory,`:

```ts
    coupons,
```

- [ ] **Step 4: Implementar o superadmin primeiro em `resolveTenantId`**

Em `apps/api/src/routes/deals.ts`, troque a função inteira (linhas 33-63) por:

```ts
async function resolveTenantId(requestTenantId?: string): Promise<string | null> {
  if (requestTenantId) return requestTenantId;

  // 1. Tenant do dono da aplicação: as páginas publicadas no envio das ofertas são dele.
  const ownerUser = await prisma.user.findFirst({
    where: { isSuperAdmin: true, tenant: { parentTenantId: null } },
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true },
  });
  if (ownerUser?.tenantId) return ownerUser.tenantId;

  // 2. Tenta achar tenant que já possui MasterProduct
  const withMaster = await prisma.masterProduct.findFirst({ select: { tenantId: true } });
  if (withMaster?.tenantId) return withMaster.tenantId;

  // 3. Tenta achar o tenant que possui produtos cadastrados na tabela Product
  const withProduct = await prisma.product.findFirst({
    select: { tenantId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (withProduct?.tenantId) return withProduct.tenantId;

  // 4. Tenta achar o tenant que possui produtos da Awin
  const withAwin = await prisma.awinCatalogProduct.findFirst({
    select: { tenantId: true },
  });
  if (withAwin?.tenantId) return withAwin.tenantId;

  // 5. Primeiro tenant
  const firstTenant = await prisma.tenant.findFirst({ select: { id: true } });
  return firstTenant?.id ?? null;
}
```

- [ ] **Step 5: Rodar os testes**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/deals-coupons.test.ts test/deals-public-tenant.test.ts test/deals-detail.test.ts`
Expected: PASS.

Run: `pnpm --filter @afilados/deals typecheck && pnpm --filter @afilados/api typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/deals/src/price-engine.ts apps/api/src/routes/deals.ts apps/api/test/deals-coupons.test.ts apps/api/test/deals-public-tenant.test.ts
git commit -m "feat(deals): cupons na página da oferta e vitrine pública servida pelo tenant do superadmin"
```

---

### Task 3: Bloco "Cupom disponível" na página `/ofertas/[slug]`

**Files:**
- Create: `apps/web/src/components/deals/deal-coupon-block.tsx`
- Modify: `apps/web/src/app/ofertas/[slug]/page.tsx` (interface `DealDetail` em `:36-64`; buy box em `:203-256`)
- Test: `apps/web/test/deal-coupon-block.test.tsx`

**Interfaces:**
- Consumes: `coupons` do `GET /api/v1/deals/:slug` (Task 2); `copyToClipboard(text): Promise<boolean>` de `apps/web/src/lib/clipboard.ts`.
- Produces: `interface DealCoupon { code: string; description: string; discountLabel: string | null; expiresAt: string | null }` e `DealCouponBlock({ coupons }: { coupons: DealCoupon[] })`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/test/deal-coupon-block.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealCouponBlock } from '@/components/deals/deal-coupon-block';

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));
import { copyToClipboard } from '@/lib/clipboard';

beforeEach(() => vi.clearAllMocks());

describe('DealCouponBlock', () => {
  it('mostra código e descrição e copia o código', async () => {
    render(
      <DealCouponBlock
        coupons={[
          {
            code: 'FONE10',
            description: 'Cupom desta oferta',
            discountLabel: 'R$ 10,00 OFF',
            expiresAt: null,
          },
        ]}
      />,
    );
    expect(screen.getByText('Cupom disponível')).toBeTruthy();
    expect(screen.getByText('FONE10')).toBeTruthy();
    expect(screen.getByText('Cupom desta oferta')).toBeTruthy();
    expect(screen.getByText('R$ 10,00 OFF')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /copiar cupom fone10/i }));
    expect(copyToClipboard).toHaveBeenCalledWith('FONE10');
    expect(await screen.findByText('Copiado!')).toBeTruthy();
  });

  it('sem cupom, não renderiza nada', () => {
    const { container } = render(<DealCouponBlock coupons={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/deal-coupon-block.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/deals/deal-coupon-block"`.

- [ ] **Step 3: Implementar o componente**

`apps/web/src/components/deals/deal-coupon-block.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Check, Copy, Ticket } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';

export interface DealCoupon {
  code: string;
  description: string;
  discountLabel: string | null;
  expiresAt: string | null;
}

export function DealCouponBlock({ coupons }: { coupons: DealCoupon[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (coupons.length === 0) return null;

  async function copy(code: string) {
    if (await copyToClipboard(code)) setCopied(code);
  }

  return (
    <section className="p-5 rounded-3xl bg-[#0e121a] border border-amber-500/40 shadow-xl mb-6">
      <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
        <Ticket className="w-4 h-4 text-amber-400" />
        Cupom disponível
      </h2>
      <ul className="space-y-3">
        {coupons.map((c) => (
          <li
            key={c.code}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-base font-black tracking-wider text-amber-300">{c.code}</code>
                {c.discountLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-bold">
                    {c.discountLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">{c.description}</p>
              {c.expiresAt && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Válido até {new Date(c.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void copy(c.code)}
              aria-label={`Copiar cupom ${c.code}`}
              className="shrink-0 py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              {copied === c.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === c.code ? 'Copiado!' : 'Copiar'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Usar o bloco na página**

Em `apps/web/src/app/ofertas/[slug]/page.tsx`, junto aos imports de `@/components/deals/...`:

```tsx
import { DealCouponBlock, type DealCoupon } from '@/components/deals/deal-coupon-block';
```

Na interface `DealDetail`, depois do campo `priceHistory: {...}[];`:

```ts
  coupons?: DealCoupon[];
```

Logo abaixo do buy box (o `div` que termina depois do botão "Criar Alerta de Preço"), troque:

```tsx
                    <span>Criar Alerta de Preço</span>
                  </button>
                </div>
              </div>
```

por:

```tsx
                    <span>Criar Alerta de Preço</span>
                  </button>
                </div>
              </div>

              <DealCouponBlock coupons={deal.coupons ?? []} />
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `pnpm --filter @afilados/web exec vitest run test/deal-coupon-block.test.tsx`
Expected: PASS (2 testes).

Run: `pnpm --filter @afilados/web typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/deals/deal-coupon-block.tsx "apps/web/src/app/ofertas/[slug]/page.tsx" apps/web/test/deal-coupon-block.test.tsx
git commit -m "feat(web): bloco de cupom na página da oferta"
```

---

### Task 4: Configuração `siteLinks` (API, tela de Configurações e migração de dados)

**Files:**
- Create: `packages/shared/src/site-links.ts`; Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/routes/site-links.ts`; Modify: `apps/api/src/app.ts:12` e `:75`
- Create: `packages/db/prisma/migrations/20261123120000_site_links_owner/migration.sql`
- Create: `apps/web/src/components/settings/site-links-toggle.tsx`
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/queries.ts:49-50`, `apps/web/src/app/(app)/config/conta/page.tsx`
- Test: `apps/api/test/site-links.test.ts`, `packages/db/test/site-links-migration.test.ts`, `apps/web/test/conta-page.test.tsx`

**Interfaces:**
- Consumes: `requireAuth`, `forbidAffiliate` (`apps/api/src/plugins/auth.ts`); `useApiMutation`, `apiFetch`, `useMe`.
- Produces:
  - `SITE_LINKS_KEY = 'siteLinks'`, `siteLinksUpdateSchema` (`{ enabled: boolean }`), `type SiteLinksSetting = { enabled: boolean }`, `siteLinksEnabled(value: unknown): boolean` — todos de `@afilados/shared`.
  - `GET /api/v1/settings/site-links` → `{ enabled: boolean }`; `PUT /api/v1/settings/site-links` com `{ enabled: boolean }` → `{ enabled: boolean }`; afiliado → 403.
  - Web: `useSiteLinks(enabled: boolean)`, `SiteLinksSettings`, `SiteLinksToggle`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/test/site-links.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let root: Awaited<ReturnType<typeof createTenantWithUser>>;
let rootCookie: string;
let affCookie: string;

const call = (method: 'GET' | 'PUT', cookie: string, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1/settings/site-links',
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

beforeAll(async () => {
  root = await createTenantWithUser('raiz-site-links');
  const aff = await createTenantWithUser('afiliado-site-links', root.tenantId);
  rootCookie = await loginCookie(app, root.email, root.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
});

afterAll(async () => {
  await cleanupTenant(root.tenantId);
  await app.close();
});

describe('settings/site-links', () => {
  it('sem configuração gravada, está desligado', async () => {
    const res = await call('GET', rootCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });

  it('PUT liga, grava em Setting e o GET reflete', async () => {
    const put = await call('PUT', rootCookie, { enabled: true });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ enabled: true });
    const row = await prisma.setting.findFirstOrThrow({
      where: { tenantId: root.tenantId, key: 'siteLinks' },
    });
    expect(row.value).toEqual({ enabled: true });
    expect((await call('GET', rootCookie)).json()).toEqual({ enabled: true });
  });

  it('PUT com corpo inválido → 400', async () => {
    const res = await call('PUT', rootCookie, { enabled: 'sim' });
    expect(res.statusCode).toBe(400);
  });

  it('afiliado não lê nem altera → 403', async () => {
    expect((await call('GET', affCookie)).statusCode).toBe(403);
    expect((await call('PUT', affCookie, { enabled: true })).statusCode).toBe(403);
  });
});
```

`packages/db/test/site-links-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/index';

const sql = readFileSync(
  fileURLToPath(
    new URL('../prisma/migrations/20261123120000_site_links_owner/migration.sql', import.meta.url),
  ),
  'utf8',
);

let owner: string;
let child: string;
let plain: string;

async function tenantWithUser(name: string, isSuperAdmin: boolean, parentTenantId?: string) {
  const t = await prisma.tenant.create({
    data: { name, ...(parentTenantId ? { parentTenantId } : {}) },
  });
  await prisma.user.create({
    data: { tenantId: t.id, email: `${t.id}@mig.test`, name, passwordHash: 'x', isSuperAdmin },
  });
  return t.id;
}

beforeAll(async () => {
  owner = await tenantWithUser('dono-mig', true);
  child = await tenantWithUser('afiliado-mig', false, owner);
  plain = await tenantWithUser('comum-mig', false);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [child, plain] } } });
  await prisma.tenant.deleteMany({ where: { id: owner } });
  await prisma.$disconnect();
});

describe('migração 20261123120000_site_links_owner', () => {
  it('liga siteLinks só para o tenant do superadmin e é idempotente', async () => {
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    const rows = await prisma.setting.findMany({
      where: { key: 'siteLinks', tenantId: { in: [owner, child, plain] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: owner, value: { enabled: true } });
  });

  it('não sobrescreve um valor já gravado', async () => {
    await prisma.setting.update({
      where: { tenantId_key: { tenantId: owner, key: 'siteLinks' } },
      data: { value: { enabled: false } },
    });
    await prisma.$executeRawUnsafe(sql);
    const row = await prisma.setting.findFirstOrThrow({
      where: { tenantId: owner, key: 'siteLinks' },
    });
    expect(row.value).toEqual({ enabled: false });
  });
});
```

`apps/web/test/conta-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContaPage from '@/app/(app)/config/conta/page';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiClientError: class extends Error {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const settings = {
  window: { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true },
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};

function mockApi(isAffiliate: boolean) {
  apiFetchMock.mockImplementation(async (url: string, opts?: unknown) => {
    if (url === '/me')
      return {
        user: { id: 'u', email: 'dono@teste.local', name: 'Dono', role: 'OWNER', isSuperAdmin: !isAffiliate },
        tenant: { id: 't', name: 'T' },
        isAffiliate,
        impersonating: null,
      } as never;
    if (url === '/settings') return settings as never;
    if (url === '/settings/site-links') return (opts ? { enabled: true } : { enabled: false }) as never;
    return {} as never;
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContaPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Minha Conta > link do site', () => {
  it('dono liga a chave e a página envia PUT /settings/site-links', async () => {
    mockApi(false);
    renderPage();
    const toggle = await screen.findByRole('switch', { name: /link do site/i });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/settings/site-links', {
        method: 'PUT',
        json: { enabled: true },
      }),
    );
  });

  it('afiliado não vê a chave nem consulta a configuração', async () => {
    mockApi(true);
    renderPage();
    await screen.findByText(/dono@teste.local/);
    expect(screen.queryByRole('switch', { name: /link do site/i })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/settings/site-links');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/site-links.test.ts`
Expected: FAIL — `GET /api/v1/settings/site-links` responde 404.

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/db exec vitest run test/site-links-migration.test.ts`
Expected: FAIL — `ENOENT` no `migration.sql`.

Run: `pnpm --filter @afilados/web exec vitest run test/conta-page.test.tsx`
Expected: FAIL — não acha o `switch` "link do site".

- [ ] **Step 3: Implementar a chave compartilhada**

`packages/shared/src/site-links.ts`:

```ts
import { z } from 'zod';

/** Chave em `Setting`: liga a troca do link da loja pelo link da página da oferta no site. */
export const SITE_LINKS_KEY = 'siteLinks';

export const siteLinksUpdateSchema = z.object({ enabled: z.boolean() });
export type SiteLinksSetting = z.infer<typeof siteLinksUpdateSchema>;

/** Valor gravado em `Setting.value`; ausente ou malformado = desligado. */
export function siteLinksEnabled(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true
  );
}
```

Em `packages/shared/src/index.ts`, ao final:

```ts
export * from './site-links';
```

- [ ] **Step 4: Implementar a rota da API**

`apps/api/src/routes/site-links.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { SITE_LINKS_KEY, siteLinksEnabled, siteLinksUpdateSchema } from '@afilados/shared';
import { forbidAffiliate, requireAuth } from '../plugins/auth';

export async function siteLinksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', forbidAffiliate);

  app.get('/settings/site-links', async (req) => {
    const row = await req.db.setting.findFirst({ where: { key: SITE_LINKS_KEY } });
    return { enabled: siteLinksEnabled(row?.value) };
  });

  app.put('/settings/site-links', async (req) => {
    const body = siteLinksUpdateSchema.parse(req.body);
    await req.db.setting.upsert({
      where: { tenantId_key: { tenantId: req.tenantId, key: SITE_LINKS_KEY } },
      update: { value: body },
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      create: { key: SITE_LINKS_KEY, value: body },
    });
    return { enabled: body.enabled };
  });
}
```

Em `apps/api/src/app.ts`, depois de `import { aiSettingsRoutes } from './routes/ai-settings';`:

```ts
import { siteLinksRoutes } from './routes/site-links';
```

e depois de `await api.register(aiSettingsRoutes);`:

```ts
      await api.register(siteLinksRoutes);
```

- [ ] **Step 5: Escrever a migração de dados**

`packages/db/prisma/migrations/20261123120000_site_links_owner/migration.sql` (um único comando, para o teste poder executá-lo com `$executeRawUnsafe`):

```sql
-- Liga o link do site nas ofertas postadas para o tenant do dono da aplicação (superadmin raiz).
-- Afiliados e demais tenants seguem com o link de afiliado direto (chave ausente = desligado).
INSERT INTO "Setting" ("tenantId", "key", "value")
SELECT DISTINCT u."tenantId", 'siteLinks', '{"enabled": true}'::jsonb
FROM "User" u
JOIN "Tenant" t ON t."id" = u."tenantId"
WHERE u."isSuperAdmin" = true AND t."parentTenantId" IS NULL
ON CONFLICT ("tenantId", "key") DO NOTHING;
```

Aplique no banco de testes:

Run: `bash .superpowers/sdd/remote.sh setup`
Expected: saída do `prisma migrate deploy` com `Applying migration \`20261123120000_site_links_owner\`` (ou "All migrations have been successfully applied" numa segunda vez).

- [ ] **Step 6: Implementar a chave na tela Minha Conta**

Em `apps/web/src/lib/types.ts`, logo depois da interface `Settings`:

```ts
export interface SiteLinksSettings {
  enabled: boolean;
}
```

Em `apps/web/src/lib/queries.ts`, adicione `SiteLinksSettings,` à lista de tipos importados de `./types` e, logo depois de `useAiSettings`:

```ts
export const useSiteLinks = (enabled: boolean) =>
  useQuery({
    queryKey: ['settings', 'site-links'],
    enabled,
    queryFn: () => apiFetch<SiteLinksSettings>('/settings/site-links'),
  });
```

`apps/web/src/components/settings/site-links-toggle.tsx`:

```tsx
'use client';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function SiteLinksToggle({
  enabled,
  onChange,
  saving,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  saving?: boolean;
}) {
  return (
    <fieldset className="grid max-w-xl gap-2 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">Link do site nas ofertas</legend>
      <div className="flex items-center gap-2">
        <Switch
          id="site-links"
          aria-label="Usar o link do site nas ofertas postadas"
          checked={enabled}
          disabled={saving ?? false}
          onCheckedChange={(v) => onChange(v)}
        />
        <Label htmlFor="site-links">Usar o link do site nas ofertas postadas</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        As ofertas enviadas aos grupos levam o link da página do produto em /ofertas, com comparativo
        de preços, cupom e o botão para a loja com o seu link de afiliado. Se a página não puder ser
        montada, a mensagem sai com o link de afiliado direto.
      </p>
    </fieldset>
  );
}
```

`apps/web/src/app/(app)/config/conta/page.tsx` completo:

```tsx
'use client';
import { SettingsForm, type SettingsPatch } from '@/components/settings/settings-form';
import { SiteLinksToggle } from '@/components/settings/site-links-toggle';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useMe, useSettings, useSiteLinks } from '@/lib/queries';

export default function ContaPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isOwner = me ? !me.isAffiliate : false;
  const { data: siteLinks } = useSiteLinks(isOwner);
  const save = useApiMutation(
    (patch: SettingsPatch) => apiFetch('/settings', { method: 'PUT', json: patch }),
    {
      invalidate: [['settings']],
      success: 'Configurações salvas',
    },
  );
  const saveSiteLinks = useApiMutation(
    (enabled: boolean) =>
      apiFetch('/settings/site-links', { method: 'PUT', json: { enabled } }),
    {
      invalidate: [['settings', 'site-links']],
      success: 'Configuração salva',
    },
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Minha Conta</h1>
      {me && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Nome:</span> {me.user.name}
          </p>
          <p>
            <span className="text-muted-foreground">E-mail:</span> {me.user.email}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Alteração de senha disponível na fase F7.
          </p>
        </div>
      )}
      {settings && (
        <SettingsForm
          key={JSON.stringify(settings)}
          value={settings}
          onSave={(p) => save.mutate(p)}
          saving={save.isPending}
        />
      )}
      {isOwner && siteLinks && (
        <SiteLinksToggle
          enabled={siteLinks.enabled}
          onChange={(v) => saveSiteLinks.mutate(v)}
          saving={saveSiteLinks.isPending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Rodar os testes e o typecheck**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/site-links.test.ts test/settings.test.ts`
Expected: PASS.

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/db exec vitest run test/site-links-migration.test.ts`
Expected: PASS (2 testes).

Run: `pnpm --filter @afilados/web exec vitest run test/conta-page.test.tsx test/settings-form.test.tsx`
Expected: PASS.

Run: `pnpm --filter @afilados/shared typecheck && pnpm --filter @afilados/api typecheck && pnpm --filter @afilados/web typecheck`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/site-links.ts packages/shared/src/index.ts apps/api/src/routes/site-links.ts apps/api/src/app.ts apps/api/test/site-links.test.ts packages/db/prisma/migrations/20261123120000_site_links_owner packages/db/test/site-links-migration.test.ts apps/web/src/components/settings/site-links-toggle.tsx apps/web/src/lib/types.ts apps/web/src/lib/queries.ts "apps/web/src/app/(app)/config/conta/page.tsx" apps/web/test/conta-page.test.tsx
git commit -m "feat(settings): chave siteLinks para o link do site nas ofertas, ligada para o superadmin"
```

---

### Task 5: `PUBLIC_SITE_URL` e `publishOffer` no worker

**Files:**
- Modify: `apps/worker/src/config.ts:3-19`
- Create: `apps/worker/src/lib/publish-offer.ts`
- Modify: `docker-compose.prod.yml:47-50`, `.env.example`
- Test: `apps/worker/test/publish-offer.test.ts`

**Interfaces:**
- Consumes: `indexProductInPriceEngine` e `IndexProductResult` (Task 1); `SITE_LINKS_KEY`, `siteLinksEnabled` (Task 4).
- Produces:
  - `config.PUBLIC_SITE_URL: string | undefined`
  - `PUBLISH_TIMEOUT_MS = 5_000`
  - `interface PublishOfferOptions { siteUrl?: string | undefined; timeoutMs?: number; index?: typeof indexProductInPriceEngine }`
  - `isSiteLinksEnabled(db: TenantClient): Promise<boolean>`
  - `publishOffer(db: TenantClient, tenantId: string, product: ProductData, affiliateUrl: string, opts?: PublishOfferOptions): Promise<string | null>`
  - `type PublishOfferFn = (tenantId: string, product: ProductData, affiliateUrl: string) => Promise<string | null>`
  - `publishOfferForTenant: PublishOfferFn` (usa `forTenant(tenantId)` e a config do processo)

- [ ] **Step 1: Escrever o teste que falha**

`apps/worker/test/publish-offer.test.ts` (sem banco: `db` e `index` são falsos):

```ts
import { describe, it, expect, vi } from 'vitest';
import type { TenantClient } from '@afilados/db';
import type { indexProductInPriceEngine } from '@afilados/deals';
import type { ProductData } from '@afilados/shared';
import { publishOffer } from '../src/lib/publish-offer';

type IndexFn = typeof indexProductInPriceEngine;

const product: ProductData = {
  source: 'SHOPEE',
  externalId: '1',
  title: 'Fone',
  price: 99.9,
  images: [],
  shipping: 'UNKNOWN',
  originalUrl: 'https://shopee.com.br/product/1/1',
  raw: {},
};

const fakeDb = (value: unknown) =>
  ({
    setting: {
      findFirst: vi.fn(async () => (value === undefined ? null : { key: 'siteLinks', value })),
    },
  }) as unknown as TenantClient;

const indexOk = () =>
  vi.fn<IndexFn>(async () => ({
    masterProductId: 'm1',
    slug: 'fone-ab12',
    isNewMaster: true,
    isPriceDrop: false,
  }));

describe('publishOffer', () => {
  it('chave ausente → null, sem indexar', async () => {
    const index = indexOk();
    const r = await publishOffer(fakeDb(undefined), 't1', product, 'https://aff', {
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBeNull();
    expect(index).not.toHaveBeenCalled();
  });

  it('chave desligada → null', async () => {
    const r = await publishOffer(fakeDb({ enabled: false }), 't1', product, 'https://aff', {
      siteUrl: 'https://site.test',
      index: indexOk(),
    });
    expect(r).toBeNull();
  });

  it('sem PUBLIC_SITE_URL → null', async () => {
    const index = indexOk();
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      siteUrl: undefined,
      index,
    });
    expect(r).toBeNull();
    expect(index).not.toHaveBeenCalled();
  });

  it('sucesso → URL da página no site, com o link de afiliado repassado ao motor', async () => {
    const index = indexOk();
    const db = fakeDb({ enabled: true });
    const r = await publishOffer(db, 't1', product, 'https://s.shopee.com.br/AFF', {
      siteUrl: 'https://site.test/',
      index,
    });
    expect(r).toBe('https://site.test/ofertas/fone-ab12');
    expect(index).toHaveBeenCalledWith(db, 't1', product, {
      affiliateUrl: 'https://s.shopee.com.br/AFF',
    });
  });

  it('exceção ao indexar → null', async () => {
    const index = vi.fn<IndexFn>(async () => {
      throw new Error('db fora');
    });
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBeNull();
  });

  it('conflito de unicidade (P2002) tenta indexar de novo uma vez', async () => {
    const index = vi
      .fn<IndexFn>()
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockResolvedValueOnce({
        masterProductId: 'm1',
        slug: 'fone-ab12',
        isNewMaster: false,
        isPriceDrop: false,
      });
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBe('https://site.test/ofertas/fone-ab12');
    expect(index).toHaveBeenCalledTimes(2);
  });

  it('indexação acima do teto de tempo → null', async () => {
    const index = vi.fn<IndexFn>(() => new Promise(() => {}));
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      siteUrl: 'https://site.test',
      timeoutMs: 20,
      index,
    });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/worker exec vitest run test/publish-offer.test.ts`
Expected: FAIL — `Failed to load url ../src/lib/publish-offer`.

- [ ] **Step 3: Adicionar a variável de ambiente**

Em `apps/worker/src/config.ts`, dentro do `z.object({...})`, depois de `METRICS_RETENTION_DAYS`:

```ts
  // Origem pública do site (ex.: https://superofertasedescontos.com.br). Vazio = ofertas seguem
  // com o link de afiliado direto, mesmo com a chave siteLinks ligada.
  PUBLIC_SITE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
```

Em `docker-compose.prod.yml`, no `environment` do serviço `worker`, depois de `NODE_ENV: production`:

```yaml
      PUBLIC_SITE_URL: https://${DOMAIN}
```

Em `.env.example`, logo depois da linha `WEB_ORIGIN=http://localhost:3000`:

```bash
# Origem pública das páginas /ofertas usada no link das ofertas postadas (worker).
# Em produção o docker-compose.prod.yml define https://${DOMAIN}. Vazio = link de afiliado direto.
PUBLIC_SITE_URL=
```

- [ ] **Step 4: Implementar `publishOffer`**

`apps/worker/src/lib/publish-offer.ts`:

```ts
import pino from 'pino';
import { forTenant, type TenantClient } from '@afilados/db';
import { indexProductInPriceEngine } from '@afilados/deals';
import { SITE_LINKS_KEY, siteLinksEnabled, type ProductData } from '@afilados/shared';
import { config } from '../config';

const log = pino({ name: 'publish-offer' });

/** Teto de tempo da indexação por produto; acima disso a mensagem sai com o link de afiliado. */
export const PUBLISH_TIMEOUT_MS = 5_000;

let warnedMissingSiteUrl = false;

export interface PublishOfferOptions {
  /** Origem pública do site; omitido = `config.PUBLIC_SITE_URL`. */
  siteUrl?: string | undefined;
  timeoutMs?: number;
  index?: typeof indexProductInPriceEngine;
}

export type PublishOfferFn = (
  tenantId: string,
  product: ProductData,
  affiliateUrl: string,
) => Promise<string | null>;

export async function isSiteLinksEnabled(db: TenantClient): Promise<boolean> {
  const row = await db.setting.findFirst({ where: { key: SITE_LINKS_KEY } });
  return siteLinksEnabled(row?.value);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`indexação passou de ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isUniqueConflict(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Publica a oferta na página /ofertas/<slug> do site e devolve a URL dela. Devolve `null` (e o
 * chamador usa o link de afiliado) quando a chave `siteLinks` do tenant está desligada, quando
 * falta `PUBLIC_SITE_URL`, em qualquer erro ou quando a indexação passa do teto de tempo.
 */
export async function publishOffer(
  db: TenantClient,
  tenantId: string,
  product: ProductData,
  affiliateUrl: string,
  opts: PublishOfferOptions = {},
): Promise<string | null> {
  try {
    if (!(await isSiteLinksEnabled(db))) return null;
    const siteUrl = 'siteUrl' in opts ? opts.siteUrl : config.PUBLIC_SITE_URL;
    if (!siteUrl) {
      if (!warnedMissingSiteUrl) {
        warnedMissingSiteUrl = true;
        log.warn({ tenantId }, 'PUBLIC_SITE_URL não definido; ofertas seguem com o link de afiliado');
      }
      return null;
    }
    const index = opts.index ?? indexProductInPriceEngine;
    const run = async () => {
      try {
        return await index(db, tenantId, product, { affiliateUrl });
      } catch (err) {
        // A importação indexa o mesmo produto em paralelo (fire-and-forget): na segunda tentativa
        // a listagem já existe e o motor só a atualiza.
        if (!isUniqueConflict(err)) throw err;
        return index(db, tenantId, product, { affiliateUrl });
      }
    };
    const indexing = run();
    // Depois do timeout a indexação segue em segundo plano; a rejeição tardia não pode vazar.
    indexing.catch(() => undefined);
    const { slug } = await withTimeout(indexing, opts.timeoutMs ?? PUBLISH_TIMEOUT_MS);
    return `${siteUrl.replace(/\/+$/, '')}/ofertas/${slug}`;
  } catch (err) {
    log.warn(
      {
        tenantId,
        source: product.source,
        url: product.originalUrl,
        err: err instanceof Error ? err.message : String(err),
      },
      'publish-offer fallback',
    );
    return null;
  }
}

/** `publishOffer` com o client escopado do tenant e a configuração do processo. */
export const publishOfferForTenant: PublishOfferFn = (tenantId, product, affiliateUrl) =>
  publishOffer(forTenant(tenantId), tenantId, product, affiliateUrl);
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `pnpm --filter @afilados/worker exec vitest run test/publish-offer.test.ts`
Expected: PASS (7 testes).

Run: `pnpm --filter @afilados/worker typecheck`
Expected: sem erros.

Este PC não tem Docker; valide o compose no servidor:

```bash
bash .superpowers/sdd/remote.sh sync
ssh -i ~/.ssh/id_ed25519_casaos -o IdentitiesOnly=yes -o BatchMode=yes edmar@192.168.15.7 \
  'cd ~/afilados-ml && DOMAIN=exemplo.test POSTGRES_PASSWORD=x docker compose -f docker-compose.prod.yml config | grep PUBLIC_SITE_URL'
```

Expected: `PUBLIC_SITE_URL: https://exemplo.test` (só no serviço worker).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/config.ts apps/worker/src/lib/publish-offer.ts apps/worker/test/publish-offer.test.ts docker-compose.prod.yml .env.example
git commit -m "feat(worker): publishOffer publica a oferta no site com teto de 5s e fallback"
```

---

### Task 6: Link do site nas mensagens por template (WhatsApp e Telegram)

**Files:**
- Modify: `apps/worker/src/processors/send-offer.ts` (`SendOfferDeps` em `:42-56`; ramo do produto em `:300-349`)
- Modify: `apps/worker/src/processors/send-telegram.ts` (`SendTelegramDeps` em `:36-43`; ramo do produto em `:171-194`)
- Test: `apps/worker/test/send-offer.test.ts` (novo `describe` no fim), `apps/worker/test/send-telegram-site-links.test.ts`

**Interfaces:**
- Consumes: `publishOffer`, `publishOfferForTenant`, `PublishOfferFn` (Task 5).
- Produces: `SendOfferDeps.publishOffer?: PublishOfferFn`; `SendTelegramDeps.publishOffer?: PublishOfferFn`.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/worker/test/send-offer.test.ts`, troque a primeira linha por:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
```

troque `import { prisma, encryptJson } from '@afilados/db';` por:

```ts
import { prisma, encryptJson, forTenant } from '@afilados/db';
```

depois de `import { closeRedis } from '../src/lib/redis';` adicione:

```ts
import { publishOffer } from '../src/lib/publish-offer';
```

e, no fim do arquivo, adicione:

```ts
describe('sendOffer com link do site (siteLinks)', () => {
  const withSite: SendOfferDeps = {
    ...deps,
    publishOffer: (tid, p, aff) =>
      publishOffer(forTenant(tid), tid, p, aff, { siteUrl: 'https://site.test' }),
  };

  afterEach(async () => {
    await prisma.setting.deleteMany({ where: { tenantId, key: 'siteLinks' } });
  });

  it('chave ligada: texto e prévia levam a página do site; a listagem guarda o link de afiliado', async () => {
    await prisma.setting.create({
      data: { tenantId, key: 'siteLinks', value: { enabled: true } },
    });
    const { item } = await makeBatch({ mediaMode: 'PREVIEW', groups: ['g1@g.us'] });
    await sendOffer(withSite, item.id);

    const master = await prisma.masterProduct.findFirstOrThrow({ where: { tenantId } });
    const siteLink = `https://site.test/ofertas/${master.slug}`;
    const m = gateway.sent[0]!.msg;
    expect(m.kind).toBe('preview');
    if (m.kind === 'preview') {
      expect(m.url).toBe(siteLink);
      expect(m.text).toBe(`*Fone* R$ 99,90\n${siteLink}`);
    }
    const listing = await prisma.productListing.findFirstOrThrow({
      where: { tenantId, source: 'SHOPEE', externalId: '1' },
    });
    expect(listing.affiliateUrl).toBe('https://s.shopee.com.br/MOCK123');
  });

  it('chave desligada: comportamento atual, com o link de afiliado', async () => {
    const { item } = await makeBatch({ mediaMode: 'PREVIEW', groups: ['g1@g.us'] });
    await sendOffer(withSite, item.id);
    const m = gateway.sent[0]!.msg;
    expect(m.kind).toBe('preview');
    if (m.kind === 'preview') {
      expect(m.url).toBe('https://s.shopee.com.br/MOCK123');
      expect(m.text).toBe('*Fone* R$ 99,90\nhttps://s.shopee.com.br/MOCK123');
    }
  });
});
```

`apps/worker/test/send-telegram-site-links.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';
import type { PublishOfferFn } from '../src/lib/publish-offer';

let tenantId: string;
let botId: string;
let templateId: string;
let productId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-site-links' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
  botId = (
    await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    })
  ).id;
  templateId = (
    await prisma.template.create({ data: { tenantId, name: 't', body: '{titulo} {link}' } })
  ).id;
  productId = (
    await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        externalId: '7',
        title: 'Mouse',
        price: 30,
        images: ['https://img/m.jpg'],
        originalUrl: 'https://shopee.com.br/product/7/7',
        raw: {},
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

function makeDeps(publishOffer: PublishOfferFn) {
  const sendPhoto = vi.fn(async () => ({ messageId: 2 }));
  const deps: SendTelegramDeps = {
    shopee: {
      ...createShopeeAdapter({ mock: true }),
      toAffiliateLink: async () => 'https://s.shopee.com.br/AFF7',
    },
    awin: createAwinAdapter(),
    now: () => new Date('2026-11-23T12:00:00-03:00'),
    publishOffer,
    makeClient: () =>
      ({
        sendMessage: vi.fn(async () => ({ messageId: 1 })),
        sendPhoto,
      }) as unknown as TelegramClient,
  };
  return { deps, sendPhoto };
}

const job = () => ({ tenantId, botId, chatId: '-1', templateId, productId });

describe('sendTelegram com link do site', () => {
  it('usa a página do site quando a publicação devolve uma URL', async () => {
    const publish = vi.fn<PublishOfferFn>(async () => 'https://site.test/ofertas/mouse-ab12');
    const { deps, sendPhoto } = makeDeps(publish);
    await sendTelegram(deps, job());
    expect(publish).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ title: 'Mouse' }),
      'https://s.shopee.com.br/AFF7',
    );
    expect(sendPhoto).toHaveBeenCalledWith(
      '-1',
      'https://img/m.jpg',
      expect.stringContaining('https://site.test/ofertas/mouse-ab12'),
    );
  });

  it('sem página publicada, mantém o link de afiliado', async () => {
    const { deps, sendPhoto } = makeDeps(async () => null);
    await sendTelegram(deps, job());
    expect(sendPhoto).toHaveBeenCalledWith(
      '-1',
      'https://img/m.jpg',
      expect.stringContaining('https://s.shopee.com.br/AFF7'),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts test/send-telegram-site-links.test.ts`
Expected: FAIL — com a chave ligada a prévia ainda leva `https://s.shopee.com.br/MOCK123`; no Telegram, `publish` nunca é chamado.

- [ ] **Step 3: Implementar no `send-offer.ts`**

Depois de `import { resolveCachedAffiliateLink } from '../lib/ml-links';`:

```ts
import { publishOfferForTenant, type PublishOfferFn } from '../lib/publish-offer';
```

Em `SendOfferDeps`, depois de `enqueueTelegram?: ...;`:

```ts
  /** Injetável em testes; por padrão publica a oferta no site (lib/publish-offer.ts). */
  publishOffer?: PublishOfferFn;
```

No ramo do produto, troque o trecho de `const cta = await resolveItemCta({` até o fim do objeto `message` (linhas 319-349) por:

```ts
    const publish = deps.publishOffer ?? publishOfferForTenant;
    const link = (await publish(tenantId, pd, affiliateLink)) ?? affiliateLink;
    const cta = await resolveItemCta({
      settings,
      templateBody: batch.template.body,
      product: pd,
      batchItemId: item.id,
      log,
      ...(deps.generateCta ? { generate: deps.generateCta } : {}),
    });
    const text = renderTemplate(batch.template.body, pd, {
      affiliateLink: link,
      now: t.toISOString(),
      cta,
    });
    const image = product.images[0];
    const imageBuffer = item.customImageData ? Buffer.from(item.customImageData) : undefined;
    const message: OutgoingMessage =
      batch.mediaMode === 'IMAGE' && (imageBuffer || image)
        ? {
            kind: 'image',
            ...(imageBuffer ? { imageBuffer } : {}),
            ...(image ? { imageUrl: image } : {}),
            caption: text,
          }
        : {
            kind: 'preview',
            text,
            title: product.title,
            description: `R$ ${Number(product.price).toFixed(2).replace('.', ',')}`,
            thumbnailUrl: image ?? '',
            url: link,
          };
```

- [ ] **Step 4: Implementar no `send-telegram.ts`**

Depois de `import { resolveCachedAffiliateLink } from '../lib/ml-links';`:

```ts
import { publishOfferForTenant, type PublishOfferFn } from '../lib/publish-offer';
```

Em `SendTelegramDeps`, depois de `makeClient?: ...;`:

```ts
  /** Injetável em testes; por padrão publica a oferta no site (lib/publish-offer.ts). */
  publishOffer?: PublishOfferFn;
```

Troque o `renderTemplate` do ramo do produto (linhas 190-194) por:

```ts
      const publish = deps.publishOffer ?? publishOfferForTenant;
      const link = (await publish(job.tenantId, pd, affiliateLink)) ?? affiliateLink;
      text = renderTemplate(template.body, pd, {
        affiliateLink: link,
        now: t.toISOString(),
        ...(job.cta ? { cta: job.cta } : {}),
      });
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts test/send-telegram-site-links.test.ts test/send-telegram-affiliate.test.ts test/send-telegram-custom.test.ts`
Expected: PASS (testes antigos inclusive: sem a chave, `publishOfferForTenant` devolve `null`).

Run: `pnpm --filter @afilados/worker typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/send-offer.ts apps/worker/src/processors/send-telegram.ts apps/worker/test/send-offer.test.ts apps/worker/test/send-telegram-site-links.test.ts
git commit -m "feat(worker): ofertas por template levam o link da página do site"
```

---

### Task 7: `rewriteOfferLinks` e o texto livre do `send-offer`

**Files:**
- Create: `apps/worker/src/lib/rewrite-offer-links.ts`
- Modify: `apps/worker/src/processors/send-offer.ts` (`SendOfferDeps`; ramo `customText` em `:140-184`)
- Test: `apps/worker/test/rewrite-offer-links.test.ts`, `apps/worker/test/send-offer.test.ts`

**Interfaces:**
- Consumes: `isSiteLinksEnabled`, `publishOfferForTenant` (Task 5); `fetchProductWithCache(tenantId, kind, url)` de `apps/worker/src/processors/product-enrich.ts`; `extractUrls`, `parseProductUrl`, `resolveShortLinks`, `rewriteLinks` de `@afilados/core`.
- Produces:
  - `MAX_OFFER_LINKS = 5`
  - `interface RewriteOfferLinksCtx { tenantId: string; knownOriginals?: Map<string, string>; isEnabled?: (tenantId: string) => Promise<boolean>; resolveShortLinks?: (text: string) => Promise<Map<string, string>>; fetchProduct?: (tenantId: string, kind: ProductEnrichJob['marketplaceKind'], url: string) => Promise<ProductData | null>; publish?: PublishOfferFn }`
  - `rewriteOfferLinks(text: string, ctx: RewriteOfferLinksCtx): Promise<string>`
  - `type RewriteOfferLinksFn = (tenantId: string, text: string, knownOriginals?: Map<string, string>) => Promise<string>`
  - `rewriteOfferLinksForTenant: RewriteOfferLinksFn`
  - `SendOfferDeps.rewriteOfferLinks?: RewriteOfferLinksFn`

- [ ] **Step 1: Escrever os testes que falham**

`apps/worker/test/rewrite-offer-links.test.ts` (sem banco):

```ts
import { describe, it, expect, vi } from 'vitest';
import type { ProductData } from '@afilados/shared';
import { rewriteOfferLinks, type RewriteOfferLinksCtx } from '../src/lib/rewrite-offer-links';

const product = (url: string): ProductData => ({
  source: 'SHOPEE',
  externalId: '20',
  title: 'Fone',
  price: 10,
  images: [],
  shipping: 'UNKNOWN',
  originalUrl: url,
  raw: {},
});

function ctx(over: Partial<RewriteOfferLinksCtx> = {}): RewriteOfferLinksCtx {
  return {
    tenantId: 't1',
    isEnabled: async () => true,
    resolveShortLinks: async () =>
      new Map([['https://s.shopee.com.br/AFF1', 'https://shopee.com.br/product/10/20']]),
    fetchProduct: vi.fn(async (_t: string, _k: string, url: string) => product(url)),
    publish: vi.fn(async () => 'https://site.test/ofertas/fone-ab12'),
    ...over,
  };
}

describe('rewriteOfferLinks', () => {
  it('troca o link de afiliado da loja pela página do site', async () => {
    const c = ctx();
    const out = await rewriteOfferLinks(
      'Corre! https://s.shopee.com.br/AFF1\nRegras: https://google.com/regras',
      c,
    );
    expect(out).toBe('Corre! https://site.test/ofertas/fone-ab12\nRegras: https://google.com/regras');
    expect(c.fetchProduct).toHaveBeenCalledWith('t1', 'SHOPEE', 'https://shopee.com.br/product/10/20');
    expect(c.publish).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ title: 'Fone' }),
      'https://s.shopee.com.br/AFF1',
    );
  });

  it('mantém o link quando o fetcher falha', async () => {
    const c = ctx({
      fetchProduct: vi.fn(async () => {
        throw new Error('scraping bloqueado');
      }),
    });
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
  });

  it('mantém o link quando a publicação devolve null', async () => {
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, ctx({ publish: async () => null }))).toBe(text);
  });

  it('ignora URLs que não são de loja', async () => {
    const c = ctx({ resolveShortLinks: async () => new Map() });
    const text = 'Veja https://google.com/x e https://exemplo.com';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
    expect(c.fetchProduct).not.toHaveBeenCalled();
  });

  it('com a chave desligada não resolve nem busca nada', async () => {
    const resolve = vi.fn(async () => new Map<string, string>());
    const c = ctx({ isEnabled: async () => false, resolveShortLinks: resolve });
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
    expect(resolve).not.toHaveBeenCalled();
    expect(c.fetchProduct).not.toHaveBeenCalled();
  });

  it('processa no máximo 5 URLs de loja por mensagem', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://www.amazon.com.br/dp/B0ABCDEF1${i}`);
    const c = ctx({ resolveShortLinks: async () => new Map() });
    await rewriteOfferLinks(urls.join('\n'), c);
    expect(c.fetchProduct).toHaveBeenCalledTimes(5);
  });

  it('usa o link original já conhecido sem resolver encurtadores', async () => {
    const resolve = vi.fn(async () => new Map<string, string>());
    const c = ctx({
      resolveShortLinks: resolve,
      knownOriginals: new Map([
        ['https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20', 'https://www.amazon.com.br/dp/B0ABCDEF12'],
      ]),
    });
    await rewriteOfferLinks('Olha https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20', c);
    expect(resolve).not.toHaveBeenCalled();
    expect(c.fetchProduct).toHaveBeenCalledWith('t1', 'AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEF12');
  });
});
```

Em `apps/worker/test/send-offer.test.ts`, dentro do `describe('sendOffer com link do site (siteLinks)', ...)` criado na Task 6, acrescente:

```ts
  it('texto livre: troca os links pela página do site, inclusive na prévia e no job do telegram', async () => {
    const bot = await prisma.telegramBot.create({
      data: { tenantId, label: 'BotSite', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    });
    await prisma.telegramChat.create({
      data: {
        tenantId,
        botId: bot.id,
        chatId: '-100888',
        title: 'Canal site',
        kind: 'channel',
        botIsAdmin: true,
      },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId,
        templateId,
        name: 'manual-site',
        groupJids: ['g1@g.us'],
        telegramChatIds: ['-100888'],
        intervalMin: 1,
        items: {
          create: [{ order: 0, runAt: new Date(), customText: 'Olha https://s.shopee.com.br/AFF1' }],
        },
      },
      include: { items: true },
    });
    const rewrite = vi.fn(async (_t: string, text: string) =>
      text.replace('https://s.shopee.com.br/AFF1', 'https://site.test/ofertas/fone-ab12'),
    );
    const enqueued: { customText?: string }[] = [];
    await sendOffer(
      {
        ...deps,
        rewriteOfferLinks: rewrite,
        enqueueTelegram: async (job) => void enqueued.push(job),
      },
      batch.items[0]!.id,
    );
    expect(rewrite).toHaveBeenCalledWith(tenantId, 'Olha https://s.shopee.com.br/AFF1');
    expect(gateway.sent[0]!.msg).toEqual({
      kind: 'preview',
      text: 'Olha https://site.test/ofertas/fone-ab12',
      url: 'https://site.test/ofertas/fone-ab12',
      title: 'Oferta',
      description: '',
      thumbnailUrl: '',
    });
    expect(enqueued[0]!.customText).toBe('Olha https://site.test/ofertas/fone-ab12');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/worker exec vitest run test/rewrite-offer-links.test.ts`
Expected: FAIL — `Failed to load url ../src/lib/rewrite-offer-links`.

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts`
Expected: FAIL — `rewrite` nunca é chamado e a prévia leva `https://s.shopee.com.br/AFF1`.

- [ ] **Step 3: Implementar `rewriteOfferLinks`**

`apps/worker/src/lib/rewrite-offer-links.ts`:

```ts
import pino from 'pino';
import {
  extractUrls,
  parseProductUrl,
  resolveShortLinks as resolveShortLinksImpl,
  rewriteLinks,
} from '@afilados/core';
import { forTenant } from '@afilados/db';
import type { ProductData, ProductEnrichJob } from '@afilados/shared';
import { fetchProductWithCache } from '../processors/product-enrich';
import { isSiteLinksEnabled, publishOfferForTenant, type PublishOfferFn } from './publish-offer';

const log = pino({ name: 'rewrite-offer-links' });

/** Teto de URLs de loja tratadas por mensagem (cada uma busca o produto e indexa). */
export const MAX_OFFER_LINKS = 5;

type FetchKind = ProductEnrichJob['marketplaceKind'];

/** Lojas com fetcher por URL; a Awin não tem (fetchByUrls devolve []). */
const FETCHABLE: ReadonlySet<string> = new Set<FetchKind>([
  'SHOPEE',
  'MERCADOLIVRE',
  'AMAZON',
  'MAGALU',
  'ALIEXPRESS',
]);

export interface RewriteOfferLinksCtx {
  tenantId: string;
  /** URL do texto → link original do produto, quando o chamador já o conhece (espelhamento). */
  knownOriginals?: Map<string, string>;
  isEnabled?: (tenantId: string) => Promise<boolean>;
  resolveShortLinks?: (text: string) => Promise<Map<string, string>>;
  fetchProduct?: (tenantId: string, kind: FetchKind, url: string) => Promise<ProductData | null>;
  publish?: PublishOfferFn;
}

export type RewriteOfferLinksFn = (
  tenantId: string,
  text: string,
  knownOriginals?: Map<string, string>,
) => Promise<string>;

/**
 * Troca cada URL de loja do texto (já convertida para afiliado) pelo link da página da oferta no
 * site. URL que não é de loja, loja sem fetcher, busca que falha ou publicação que devolve `null`
 * mantém o link de afiliado.
 */
export async function rewriteOfferLinks(text: string, ctx: RewriteOfferLinksCtx): Promise<string> {
  const isEnabled = ctx.isEnabled ?? ((t: string) => isSiteLinksEnabled(forTenant(t)));
  if (!(await isEnabled(ctx.tenantId).catch(() => false))) return text;

  const urls = [...new Set(extractUrls(text))];
  if (urls.length === 0) return text;

  const known = ctx.knownOriginals ?? new Map<string, string>();
  const resolve = ctx.resolveShortLinks ?? ((t: string) => resolveShortLinksImpl(t));
  const expansions = urls.every((u) => known.has(u))
    ? new Map<string, string>()
    : await resolve(text).catch(() => new Map<string, string>());
  const fetchProduct = ctx.fetchProduct ?? fetchProductWithCache;
  const publish = ctx.publish ?? publishOfferForTenant;

  const replacements = new Map<string, string>();
  let processed = 0;
  for (const url of urls) {
    if (processed >= MAX_OFFER_LINKS) break;
    const original = known.get(url) ?? expansions.get(url) ?? url;
    const parsed = parseProductUrl(original);
    if (parsed.source === 'UNSUPPORTED' || !FETCHABLE.has(parsed.source)) continue;
    processed++;
    try {
      const product = await fetchProduct(ctx.tenantId, parsed.source as FetchKind, original);
      if (!product) continue;
      const siteUrl = await publish(ctx.tenantId, product, url);
      if (siteUrl) replacements.set(url, siteUrl);
    } catch (err) {
      log.warn(
        { tenantId: ctx.tenantId, url, err: err instanceof Error ? err.message : String(err) },
        'não foi possível montar a página da oferta; mantendo o link de afiliado',
      );
    }
  }
  return replacements.size > 0 ? rewriteLinks(text, replacements) : text;
}

export const rewriteOfferLinksForTenant: RewriteOfferLinksFn = (tenantId, text, knownOriginals) =>
  rewriteOfferLinks(text, { tenantId, ...(knownOriginals ? { knownOriginals } : {}) });
```

- [ ] **Step 4: Usar no ramo `customText` do `send-offer.ts`**

Ajuste o import criado na Task 6 e acrescente o novo:

```ts
import { publishOfferForTenant, type PublishOfferFn } from '../lib/publish-offer';
import { rewriteOfferLinksForTenant, type RewriteOfferLinksFn } from '../lib/rewrite-offer-links';
```

Em `SendOfferDeps`, depois de `publishOffer?: PublishOfferFn;`:

```ts
  /** Injetável em testes; por padrão troca os links de loja do texto livre pela página do site. */
  rewriteOfferLinks?: RewriteOfferLinksFn;
```

Troque o ramo inteiro `if (item.customText) { ... }` (linhas 140-184) por:

```ts
    if (item.customText) {
      const rewrite = deps.rewriteOfferLinks ?? rewriteOfferLinksForTenant;
      const customText = await rewrite(tenantId, item.customText);
      let message: OutgoingMessage;
      if (item.customImageData) {
        message = {
          kind: 'image',
          imageBuffer: Buffer.from(item.customImageData),
          caption: customText,
        };
      } else if (item.customImageUrl) {
        message = { kind: 'image', imageUrl: item.customImageUrl, caption: customText };
      } else {
        const urlMatch = customText.match(/https?:\/\/[^\s<>"')]+/);
        if (urlMatch) {
          message = {
            kind: 'preview',
            text: customText,
            url: urlMatch[0],
            title: 'Oferta',
            description: '',
            thumbnailUrl: '',
          };
        } else {
          message = { kind: 'text', text: customText };
        }
      }
      return sendPlainMessages(
        deps,
        {
          id: item.id,
          productId: null,
          couponId: null,
          customText,
          customImageUrl: item.customImageUrl,
          hasCustomImageData: Boolean(item.customImageData),
        },
        batch,
        tenantId,
        message,
        now,
        sleep,
        rng,
        bucketFor(batch.sessionId, ratePerMin),
        enqueueTelegram,
      );
    }
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `pnpm --filter @afilados/worker exec vitest run test/rewrite-offer-links.test.ts`
Expected: PASS (7 testes).

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts`
Expected: PASS (os testes antigos de texto livre seguem iguais: sem a chave, o texto não muda).

Run: `pnpm --filter @afilados/worker typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/lib/rewrite-offer-links.ts apps/worker/src/processors/send-offer.ts apps/worker/test/rewrite-offer-links.test.ts apps/worker/test/send-offer.test.ts
git commit -m "feat(worker): texto livre troca links de loja pela página da oferta no site"
```

---

### Task 8: Link do site no espelhamento (CLONE e TEMPLATE)

**Files:**
- Modify: `apps/worker/src/processors/mirror-message.ts` (`MirrorMessageDeps` em `:49-58`; montagem das mensagens em `:310-343`)
- Test: `apps/worker/test/mirror-site-links.test.ts`

**Interfaces:**
- Consumes: `publishOfferForTenant`, `PublishOfferFn` (Task 5); `rewriteOfferLinksForTenant`, `RewriteOfferLinksFn` (Task 7).
- Produces: `MirrorMessageDeps.publishOffer?: PublishOfferFn`; `MirrorMessageDeps.rewriteOfferLinks?: RewriteOfferLinksFn`. No CLONE, `rewriteOfferLinks` recebe o mapa `link de afiliado no texto → link original` (`knownOriginals`).

- [ ] **Step 1: Escrever o teste que falha**

`apps/worker/test/mirror-site-links.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import type { MirrorMessageJob } from '@afilados/shared';
import { mirrorMessage, type MirrorMessageDeps } from '../src/processors/mirror-message';
import type { PublishOfferFn } from '../src/lib/publish-offer';
import type { RewriteOfferLinksFn } from '../src/lib/rewrite-offer-links';
import type { WhatsAppGateway } from '../src/wa/gateway';

const { publishEvent } = vi.hoisted(() => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock('../src/lib/events', () => ({ publishEvent }));

const gateway = {
  isConnected: vi.fn(() => true),
  sendMessage: vi.fn(async () => ({ messageId: 'wa-site' })),
  fetchGroups: vi.fn(async () => []),
  onMessage: vi.fn(),
  downloadMedia: vi.fn(async () => Buffer.from('')),
  createGroup: vi.fn(async () => ({ jid: 'new@g.us' })),
  updateGroupParticipants: vi.fn(async () => {}),
  updateGroupSettings: vi.fn(async () => {}),
  getInviteCode: vi.fn(async () => 'ABC'),
  getGroupDetails: vi.fn(async () => ({
    jid: 'g@g.us',
    subject: 'Grupo',
    description: null,
    announceOnly: false,
    inviteCode: null,
    participants: [],
  })),
  onGroupParticipants: vi.fn(),
  getGroupSnapshot: vi.fn(async (_s: string, jid: string) => ({
    jid,
    subject: 'Grupo',
    memberCount: 1,
    inviteCode: null,
  })),
  updateGroupPicture: vi.fn(async () => {}),
} satisfies WhatsAppGateway;

let tenantId: string;
let sessionId: string;
let templateId: string;

const baseDeps = (): MirrorMessageDeps => ({
  gateway,
  sleep: async () => {},
  now: () => new Date('2026-11-23T12:00:00-03:00'),
  bucketFor: () => ({ take: async () => 0 }),
  resolveShortLinks: async () => new Map(),
});

const job = (ruleId: string, msgId: string, text: string): MirrorMessageJob => ({
  tenantId,
  ruleId,
  sessionId,
  sourceJid: 's@g.us',
  msgId,
  message: { message: { conversation: text } },
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'mirror-site-links' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  templateId = (
    await prisma.template.create({
      data: { tenantId, name: 'T', body: '{titulo} {link}', isDefault: true },
    })
  ).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AMAZON',
      affiliateTag: 'minha-20',
      encryptedCredentials: encryptJson({ tag: 'minha-20' }),
      status: 'OK',
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
      status: 'OK',
    },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('espelhamento com link do site', () => {
  it('CLONE: passa o texto convertido e os links originais para rewriteOfferLinks e envia o resultado', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t9@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const affiliate = 'https://www.amazon.com.br/dp/B0SITELNK1?tag=minha-20';
    const rewrite = vi.fn<RewriteOfferLinksFn>(async (_t, text) =>
      text.replace(affiliate, 'https://site.test/ofertas/livro-ab12'),
    );
    gateway.sendMessage.mockClear();
    const res = await mirrorMessage(
      { ...baseDeps(), rewriteOfferLinks: rewrite },
      job(rule.id, 'M-site-clone', 'Olha: https://www.amazon.com.br/dp/B0SITELNK1'),
    );
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(rewrite).toHaveBeenCalledWith(
      tenantId,
      `Olha: ${affiliate}`,
      new Map([[affiliate, 'https://www.amazon.com.br/dp/B0SITELNK1']]),
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't9@g.us',
      { kind: 'text', text: 'Olha: https://site.test/ofertas/livro-ab12' },
      { dedupeEcho: true },
    );
  });

  it('TEMPLATE (Shopee): o template e a prévia levam a página do site', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t8@g.us'],
        mode: 'TEMPLATE',
        templateId,
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const publish = vi.fn<PublishOfferFn>(async () => 'https://site.test/ofertas/caixa-ab12');
    gateway.sendMessage.mockClear();
    const res = await mirrorMessage(
      {
        ...baseDeps(),
        publishOffer: publish,
        getAdapter: () =>
          ({
            toAffiliateLink: async () => 'https://s.shopee.com.br/AFF9',
            fetchByUrls: async (_c: unknown, urls: string[]) => [
              {
                source: 'SHOPEE',
                externalId: '99',
                title: 'Caixa de som',
                price: 50,
                images: ['https://img/s.jpg'],
                shipping: 'UNKNOWN',
                originalUrl: urls[0]!,
                raw: {},
              },
            ],
          }) as never,
      },
      job(rule.id, 'M-site-template', 'Promo https://shopee.com.br/product/10/99'),
    );
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(publish).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ title: 'Caixa de som' }),
      'https://s.shopee.com.br/AFF9',
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't8@g.us',
      expect.objectContaining({
        kind: 'preview',
        text: 'Caixa de som https://site.test/ofertas/caixa-ab12',
        url: 'https://site.test/ofertas/caixa-ab12',
      }),
      { dedupeEcho: true },
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/mirror-site-links.test.ts`
Expected: FAIL — `rewrite` e `publish` nunca são chamados; as mensagens saem com os links de afiliado.

- [ ] **Step 3: Implementar no `mirror-message.ts`**

Depois de `import { publishEvent } from '../lib/events';`:

```ts
import { publishOfferForTenant, type PublishOfferFn } from '../lib/publish-offer';
import { rewriteOfferLinksForTenant, type RewriteOfferLinksFn } from '../lib/rewrite-offer-links';
```

Em `MirrorMessageDeps`, depois de `resolveShortLinks?: ...;`:

```ts
  /** Injetável em testes; por padrão publica a oferta no site (modo TEMPLATE). */
  publishOffer?: PublishOfferFn;
  /** Injetável em testes; por padrão troca os links de loja pela página do site (modo CLONE). */
  rewriteOfferLinks?: RewriteOfferLinksFn;
```

Troque o bloco de `const outgoingMessages: OutgoingMessage[] = [];` até o fim do `else if (template) { ... }` (linhas 310-343) por:

```ts
  const outgoingMessages: OutgoingMessage[] = [];
  if (effectiveMode === 'CLONE') {
    const affiliateText = rewriteLinks(text, replacements);
    // O link original de cada URL já convertida é conhecido aqui: evita resolver encurtador de novo.
    const knownOriginals = new Map<string, string>();
    for (const l of resolvedLinks) {
      knownOriginals.set(replacements.get(l.textUrl) ?? l.textUrl, l.targetUrl);
    }
    const rewriteOffers = deps.rewriteOfferLinks ?? rewriteOfferLinksForTenant;
    const newText = await rewriteOffers(tenantId, affiliateText, knownOriginals);
    if (rule.mediaMode === 'IMAGE' && hasImage(jobData.message)) {
      const imageBuffer = await downloadMedia(jobData.sessionId, jobData.message);
      outgoingMessages.push({ kind: 'image', imageBuffer, caption: newText });
    } else {
      // Sem dado real de produto pra título/thumbnail aqui (CLONE não busca na API do
      // marketplace) — mandar 'preview' com campos em branco faz o WhatsApp aceitar esse
      // linkPreview vazio como definitivo e NÃO gerar a prévia real a partir do link, virando
      // uma mensagem com o link pelado. Texto simples deixa o WhatsApp buscar a prévia sozinho.
      outgoingMessages.push({ kind: 'text', text: newText });
    }
  } else if (template) {
    const publish = deps.publishOffer ?? publishOfferForTenant;
    for (const item of templateProducts) {
      const link = (await publish(tenantId, item.product, item.convertedUrl)) ?? item.convertedUrl;
      const body = renderTemplate(template.body, item.product, {
        affiliateLink: link,
        now: t.toISOString(),
      });
      const firstImg = item.product.images?.[0];
      if (rule.mediaMode === 'IMAGE' && firstImg) {
        outgoingMessages.push({ kind: 'image', imageUrl: firstImg, caption: body });
      } else {
        outgoingMessages.push({
          kind: 'preview',
          text: body,
          title: item.product.title,
          description: `R$ ${Number(item.product.price).toFixed(2).replace('.', ',')}`,
          thumbnailUrl: firstImg ?? '',
          url: link,
        });
      }
    }
  }
```

- [ ] **Step 4: Rodar os testes e o typecheck**

Run: `bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/mirror-site-links.test.ts test/mirror-message.test.ts test/mirror-listener.test.ts`
Expected: PASS (os testes antigos seguem iguais: sem a chave, `rewriteOfferLinksForTenant` devolve o texto e `publishOfferForTenant` devolve `null`).

Run: `pnpm --filter @afilados/worker typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/processors/mirror-message.ts apps/worker/test/mirror-site-links.test.ts
git commit -m "feat(worker): espelhamento leva a página da oferta no site (CLONE e TEMPLATE)"
```

---

### Task 9: Verificação final (suítes, Docker no servidor e envio real)

**Files:**
- Nenhum arquivo novo. Só corrige o que as verificações apontarem, no arquivo da task responsável.

**Interfaces:**
- Consumes: tudo das Tasks 1-8.
- Produces: evidência de que a branch está pronta (saídas dos comandos e o resultado do envio real).

- [ ] **Step 1: Typecheck e formatação do monorepo**

Run: `pnpm typecheck`
Expected: todos os pacotes sem erro (inclui `@afilados/deals`).

Run: `git diff --name-only main...HEAD | xargs pnpm exec prettier --check`
Expected: os arquivos desta branch seguem o Prettier (se algum não seguir, rode `pnpm exec prettier --write` nele e faça commit `style: prettier nos arquivos do link do site`).

- [ ] **Step 2: Suítes completas no servidor**

```bash
bash .superpowers/sdd/remote.sh setup
bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/deals exec vitest run
bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/db exec vitest run
bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run
bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run
bash .superpowers/sdd/remote.sh run pnpm --filter @afilados/web exec vitest run
```

Expected: tudo PASS. Falha conhecida e anterior a esta branch: `apps/api/test/templates-kind.test.ts` "sem couponId usa o cupom de exemplo" (`'SHOPEE'` vs `'Shopee'`). Qualquer outra falha é desta branch e precisa ser corrigida antes de seguir.

- [ ] **Step 3: Validação no Docker do servidor**

```bash
bash .superpowers/sdd/remote.sh sync
ssh -i ~/.ssh/id_ed25519_casaos -o IdentitiesOnly=yes -o BatchMode=yes edmar@192.168.15.7 \
  'cd ~/afilados-ml && docker build -f deploy/Dockerfile.api -t afilados-ml-api:site-links . \
   && docker build -f deploy/Dockerfile.worker -t afilados-ml-worker:site-links . \
   && docker build -f deploy/Dockerfile.web -t afilados-ml-web:site-links .'
```

Expected: as três imagens constroem (o `pnpm install --frozen-lockfile` acha `packages/deals`).

```bash
ssh -i ~/.ssh/id_ed25519_casaos -o IdentitiesOnly=yes -o BatchMode=yes edmar@192.168.15.7 'bash -s' <<'EOF'
set -e
docker run --rm afilados-ml-worker:site-links sh -c 'cd apps/worker && pnpm exec tsx -e "Promise.all([import(\"@afilados/deals\"), import(\"./src/lib/publish-offer.ts\")]).then(([d, p]) => { if (typeof d.indexProductInPriceEngine !== \"function\" || typeof p.publishOffer !== \"function\") process.exit(1); console.log(\"worker ok\"); process.exit(0); })"'
docker run --rm --network host -e DATABASE_URL=postgresql://afilados:afilados@localhost:5435/afilados afilados-ml-api:site-links sh -c 'pnpm --filter @afilados/db exec prisma migrate deploy'
EOF
```

Expected: `worker ok`; o `migrate deploy` dentro da imagem da API termina com "All migrations have been successfully applied" (a migração `20261123120000_site_links_owner` já aplicada no banco de testes pelo `setup`).

Depois de validar, remova as imagens de teste para não ocupar o servidor:

```bash
ssh -i ~/.ssh/id_ed25519_casaos -o IdentitiesOnly=yes -o BatchMode=yes edmar@192.168.15.7 \
  'docker image rm afilados-ml-api:site-links afilados-ml-worker:site-links afilados-ml-web:site-links'
```

- [ ] **Step 4: Envio real para um grupo de teste (precisa do usuário)**

Este passo envia mensagem de verdade no WhatsApp: peça ao usuário o grupo de teste e a confirmação antes de executar. Checklist, no ambiente onde o worker roda com `PUBLIC_SITE_URL` definido e a migração aplicada:

1. Em Configurações > Minha Conta (logado como dono), confirme que "Usar o link do site nas ofertas postadas" está ligado.
2. Envie um produto da Shopee para o grupo de teste por um lote (Enviar > lote com 1 item). Esperado: a mensagem traz `https://<DOMAIN>/ofertas/<slug>` e a prévia aponta para essa URL.
3. Abra o link: a página mostra o comparativo, o bloco "Cupom disponível" (quando houver) e o botão da loja leva ao link `s.shopee.com.br/...` convertido.
4. Envie o mesmo produto como texto livre (Envio manual com o link de afiliado colado). Esperado: o link do texto vira a página do site.
5. Desligue a chave e repita o item 2. Esperado: a mensagem volta a sair com o link de afiliado direto.
6. Registre no log do worker: nenhum `publish-offer fallback` inesperado durante os envios dos itens 2 e 4.

- [ ] **Step 5: Commit (só se houve correções)**

```bash
git status
git add <arquivos corrigidos>
git commit -m "fix: ajustes da verificação final do link do site"
```

---

## Self-Review

**1. Cobertura da spec**

| Requisito da spec | Task |
|---|---|
| §1 pacote `@afilados/deals`, usado por API e worker | 1 |
| §1 `affiliateUrl` gravado / preservado / `originalUrl` em listagem nova | 1 |
| §1 retorno com `slug` | 1 |
| §1/§4 `getDealDetailBySlug` com `coupons` e a regra de cupom | 2 |
| §4 `resolveTenantId` prefere o superadmin | 2 |
| §4 bloco "Cupom disponível" com código, descrição e "Copiar"; some sem cupom | 3 |
| §5 chave `siteLinks`, `forbidAffiliate`, ausente = desligado, migração para o superadmin | 4 |
| §2 `publishOffer` (chave, `PUBLIC_SITE_URL` com aviso único, indexação, URL, 5 s, log `publish-offer fallback`) | 5 |
| §2 `PUBLIC_SITE_URL` em `config.ts` e no `docker-compose.prod.yml` | 5 |
| §3 template: `send-offer` (legenda e prévia) e `send-telegram` | 6 |
| §3 texto livre: `rewriteOfferLinks`, máx. 5 URLs, prévia com a primeira URL reescrita, `customText` do `send-offer` | 7 |
| §3 espelhamento CLONE e TEMPLATE | 8 |
| §3 cupom sozinho sem mudança | nenhum código toca o ramo `couponId` (6/7 só alteram os ramos de produto e `customText`) |
| Erros: envio nunca bloqueia | 5 (try/catch + timeout), 7 (try/catch por URL), 6/8 (`?? affiliateLink`) |
| Testes listados na spec | 1, 2, 3, 4, 5, 6, 7, 8 |
| Validação final: Docker no servidor e envio real | 9 |

**2. Placeholders:** nenhum "TBD"/"TODO"; todo passo de código traz o código. A única linha com `<arquivos corrigidos>` está no commit condicional da Task 9, que depende do que a verificação apontar.

**3. Consistência de tipos:** `IndexProductResult.slug` (Task 1) é o que `publishOffer` lê (Task 5); `PublishOfferFn = (tenantId, product, affiliateUrl)` é a mesma assinatura em `SendOfferDeps`, `SendTelegramDeps`, `MirrorMessageDeps` e `RewriteOfferLinksCtx.publish`; `RewriteOfferLinksFn = (tenantId, text, knownOriginals?)` é usada igual no `send-offer` (2 argumentos) e no espelhamento (3 argumentos); `DealCoupon` da API tem `expiresAt: Date | null` e o da web `string | null`, que é o mesmo campo depois da serialização JSON; `SITE_LINKS_KEY`/`siteLinksEnabled` vêm de `@afilados/shared` na API e no worker.
