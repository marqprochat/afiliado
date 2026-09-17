# Automação — Descoberta ML/Amazon/Magalu (Plano 2/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender a descoberta automática de ofertas (hoje só Shopee, entregue no Plano 1/3) para também buscar por palavra-chave em Mercado Livre, Amazon e Magalu, e implementar o "mix aleatório" de verdade (sortear 1 marketplace por rodada entre os habilitados na regra) — o Plano 1 só tinha 1 marketplace no pool, então o sorteio era desnecessário até agora.

**Architecture:** Cada scraper (`packages/marketplaces/src/scrapers/*`) ganha uma função `discoverByKeyword(keyword)` que busca a página pública de resultados de busca (não o hub de "ofertas do dia" — mais estável, spec §4.1) e extrai as URLs de produto **reaproveitando `parseProductUrl`** (já sabe reconhecer o formato de URL de cada marketplace) para filtrar links de navegação/anúncio/paginação sem precisar adivinhar classes CSS do site. As URLs encontradas alimentam o `fetchByUrls` do `tag-adapter` já existente (mesmo caminho do `product-enrich`), então o worker's `discoverForRule` não muda a forma como enriquece produto — só ganha uma fonte a mais de URLs antes desse passo. `AutomationScheduler.dispatchNext` passa a sortear 1 marketplace do array `rule.marketplaces` antes de chamar `discover`.

**Tech Stack:** `cheerio` (já usado nos scrapers existentes), `fetch` nativo via `fetchHtml` (já existe), Redis para cache por keyword+marketplace (mesmo padrão do `product-enrich`), Vitest.

## Global Constraints

- Descoberta usa a página de **busca por palavra-chave**, nunca o hub de "ofertas do dia" (spec §2, §4.1) — hub costuma depender de JS, busca é server-rendered.
- Falha de scraping em um marketplace não pode travar o scheduler nem afetar outras regras — captura, loga `AutomationLog { action: 'ERROR' }`, segue em frente (mesmo padrão já implementado para Shopee no Plano 1, spec §5.1).
- Nenhum produto incompleto é enfileirado — o portão de elegibilidade (`isEligibleProduct`, já existe) roda igual para produtos de qualquer marketplace, sem exceção.
- Cache por keyword+marketplace (TTL curto) para não martelar o site a cada tick de regras com keywords parecidas (spec §8.2) — mesmo padrão de cache já usado em `apps/worker/src/processors/product-enrich.ts`.
- ML/Amazon/Magalu **não exigem `MarketplaceConnection`** para a descoberta (diferente da Shopee): a busca é scraping público e o enriquecimento via `getTagAdapter(kind).fetchByUrls({}, urls)` não depende de credenciais — credenciais só entram depois, na hora de gerar o link de afiliado (`sendOffer`, já implementado).

---

## Referências do código existente (ler antes de começar)

- `packages/marketplaces/src/scrapers/fetcher.ts` — `fetchHtml`, `parseMoney` já existentes.
- `packages/marketplaces/src/scrapers/amazon.ts`, `mercadolivre.ts`, `magalu.ts` — scrapers de página de produto único (`scrapeAmazon`, `scrapeMercadoLivre`, `scrapeMagalu`), padrão de seletor com fallback a reaproveitar no estilo de código.
- `packages/core/src/urls.ts` — `parseProductUrl(url): { source, externalId } | { source: 'UNSUPPORTED', reason }`, já reconhece o formato de URL de produto de cada marketplace.
- `packages/marketplaces/src/tag-adapter.ts` — `createTagAdapter(kind).fetchByUrls(creds, urls)`, usado para enriquecer as URLs descobertas.
- `apps/worker/src/automation/discovery.ts` (Plano 1) — `discoverForRule`, `matchesFilters`, o loop de upsert+queue+log a generalizar.
- `apps/worker/src/automation/scheduler.ts` (Plano 1) — `dispatchNext`, onde entra o sorteio de marketplace.
- `apps/worker/src/processors/product-enrich.ts` — padrão de cache Redis por chave (`cacheKey`, `redisCache()`, TTL) a replicar.
- Spec completa: `docs/superpowers/specs/2026-09-17-automacao-disparo-design.md` (§4.1, §8.1, §8.2).

---

### Task 1: Scrapers — `discoverByKeyword` para Mercado Livre, Amazon e Magalu

**Files:**
- Create: `packages/marketplaces/src/scrapers/discovery.ts`
- Modify: `packages/marketplaces/src/scrapers/index.ts`
- Test: `packages/marketplaces/test/discovery.test.ts`

**Interfaces:**
- Consome: `fetchHtml` (`./fetcher.ts`, já existe), `parseProductUrl` (`@afilados/core`, já existe).
- Produz: `discoverMercadoLivreByKeyword(keyword: string, deps?: { fetchHtml?: typeof fetchHtml }): Promise<string[]>`, `discoverAmazonByKeyword(...)`, `discoverMagaluByKeyword(...)` — cada uma retorna até 20 URLs de produto únicas (por `externalId`), usadas pela Task 2.

- [ ] **Step 1: Escrever o teste (falha primeiro)**

Criar `packages/marketplaces/test/discovery.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
} from '../src/scrapers/discovery';

const AMAZON_SEARCH_HTML = `
<html><body>
  <div class="s-main-slot">
    <a href="/dp/B08N5WRWNW/ref=sr_1_1">Fone Bluetooth</a>
    <a href="/dp/B08N5WRWNW/ref=sr_1_1_variant">Mesmo produto, link duplicado</a>
    <a href="/gp/product/B07XJ8C8F5">Caixa de Som</a>
    <a href="/s?k=fone&page=2">Próxima página (não é produto)</a>
    <a href="https://www.amazon.com.br/ap/signin">Login (não é produto)</a>
  </div>
</body></html>`;

const ML_SEARCH_HTML = `
<html><body>
  <ol class="ui-search-layout">
    <li><a href="https://produto.mercadolivre.com.br/MLB-1234567890-fone-bluetooth-_JM">Fone Bluetooth</a></li>
    <li><a href="https://www.mercadolivre.com.br/fone-bluetooth/p/MLB1234567890">Mesmo produto (variante /p/)</a></li>
    <li><a href="https://www.mercadolivre.com.br/perfil/vendedor">Perfil do vendedor (não é produto)</a></li>
  </ol>
</body></html>`;

const MAGALU_SEARCH_HTML = `
<html><body>
  <div data-testid="product-list">
    <a href="https://www.magazineluiza.com.br/fone-bluetooth/p/ab12cd3efg/te/fone/">Fone Bluetooth</a>
    <a href="https://www.magazineluiza.com.br/busca/fone/?page=2">Próxima página (não é produto)</a>
  </div>
</body></html>`;

describe('discoverMercadoLivreByKeyword', () => {
  it('extrai URLs de produto únicas e descarta links de navegação', async () => {
    const urls = await discoverMercadoLivreByKeyword('fone', {
      fetchHtml: async () => ML_SEARCH_HTML,
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('MLB-1234567890');
  });
});

describe('discoverAmazonByKeyword', () => {
  it('extrai URLs de produto únicas (absolutas) e descarta paginação/login', async () => {
    const urls = await discoverAmazonByKeyword('fone', { fetchHtml: async () => AMAZON_SEARCH_HTML });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith('https://www.amazon.com.br'))).toBe(true);
  });
});

describe('discoverMagaluByKeyword', () => {
  it('extrai URLs de produto e descarta paginação', async () => {
    const urls = await discoverMagaluByKeyword('fone', { fetchHtml: async () => MAGALU_SEARCH_HTML });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/p/ab12cd3efg/');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd packages/marketplaces && npx vitest run test/discovery.test.ts
```

Expected: FAIL — módulo `../src/scrapers/discovery` não existe.

- [ ] **Step 3: Implementar `packages/marketplaces/src/scrapers/discovery.ts`**

```typescript
import * as cheerio from 'cheerio';
import { parseProductUrl } from '@afilados/core';
import { fetchHtml as defaultFetchHtml } from './fetcher';

const MAX_RESULTS = 20;

export interface DiscoverByKeywordDeps {
  fetchHtml?: (url: string) => Promise<string>;
}

function extractProductUrls(
  html: string,
  baseUrl: string,
  source: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  $('a[href]').each((_, el) => {
    if (urls.length >= MAX_RESULTS) return;
    const href = $(el).attr('href');
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const parsed = parseProductUrl(absolute);
    if (parsed.source !== source) return;
    const dedupeKey = `${parsed.source}:${parsed.externalId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    urls.push(absolute);
  });

  return urls;
}

export async function discoverMercadoLivreByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'MERCADOLIVRE');
}

export async function discoverAmazonByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(keyword)}`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'AMAZON');
}

export async function discoverMagaluByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(keyword)}/`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'MAGALU');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd packages/marketplaces && npx vitest run test/discovery.test.ts
```

Expected: PASS (3 testes).

- [ ] **Step 5: Exportar o novo módulo**

Adicionar `export * from './discovery';` em `packages/marketplaces/src/scrapers/index.ts`.

- [ ] **Step 6: Rodar a suíte inteira do pacote**

```bash
cd packages/marketplaces && npx vitest run
```

Expected: PASS, nenhuma regressão.

- [ ] **Step 7: Commit**

```bash
git add packages/marketplaces
git commit -m "feat(marketplaces): discoverByKeyword para Mercado Livre, Amazon e Magalu via busca pública

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

**Nota para quem implementar:** os testes acima usam HTML sintético (fixture inline), não uma resposta real do site — isso é intencional (mantém o teste rápido e sem rede), mas significa que a extração real depende só de `parseProductUrl` reconhecer a URL, não de nenhuma classe CSS específica do site. **Antes de considerar a task pronta**, faça pelo menos uma chamada manual real (`curl` ou o `fetchHtml` de verdade) contra cada uma das 3 URLs de busca para confirmar que a página de fato retorna HTML com links de produto no formato que `parseProductUrl` reconhece (ex: Amazon pode servir HTML diferente para bots/sem JS — se a extração real vier vazia, documente isso como um risco encontrado e não invente seletor CSS adicional sem verificar contra a página real).

---

### Task 2: Worker — generalizar `discoverForRule` para múltiplos marketplaces + mix aleatório

**Files:**
- Modify: `apps/worker/src/automation/discovery.ts`
- Modify: `apps/worker/src/automation/scheduler.ts`
- Test: `apps/worker/test/automation-discovery.test.ts` (adicionar casos)
- Test: `apps/worker/test/automation-scheduler.test.ts` (adicionar caso do sorteio)

**Interfaces:**
- Consome: `discoverMercadoLivreByKeyword`/`discoverAmazonByKeyword`/`discoverMagaluByKeyword` (Task 1), `getTagAdapter` (`@afilados/marketplaces`, já existe).
- Produz: `discoverForRule(rule, deps?)` agora aceita e usa `rule.marketplaces` inteiro (não só Shopee); `AutomationScheduler.dispatchNext` sorteia 1 marketplace antes de chamar `discover`.

- [ ] **Step 1: Escrever os novos testes de descoberta (falha primeiro)**

Adicionar a `apps/worker/test/automation-discovery.test.ts` (reaproveitando o `beforeAll`/`afterAll` já existentes no arquivo):

```typescript
import { discoverForRule } from '../src/automation/discovery';
// (imports já existentes no arquivo continuam)

describe('discoverForRule (Mercado Livre / Amazon / Magalu)', () => {
  it('descobre produto do Mercado Livre sem exigir MarketplaceConnection', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-ml',
        marketplaces: ['MERCADOLIVRE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 'sml' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 'tml', body: 'x' } })).id,
      },
    });

    const foundUrl = 'https://produto.mercadolivre.com.br/MLB-9999999999-fone-bluetooth';
    const enriched = {
      source: 'MERCADOLIVRE' as const,
      externalId: 'MLB9999999999',
      title: 'Fone Bluetooth ML',
      price: 80,
      images: ['https://x/ml.png'],
      shipping: 'FREE' as const,
      originalUrl: foundUrl,
      raw: {},
    };

    await discoverForRule(rule, {
      pickMarketplace: () => 'MERCADOLIVRE',
      discoverByKeyword: { MERCADOLIVRE: async () => [foundUrl] },
      fetchByUrls: { MERCADOLIVRE: async () => [enriched] },
    });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(1);
    expect(items[0]!.product!.source).toBe('MERCADOLIVRE');
  });

  it('loga ERROR e não derruba a regra quando o scraper falha', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-amazon-falha',
        marketplaces: ['AMAZON'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 'sam' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 'tam', body: 'x' } })).id,
      },
    });

    await discoverForRule(rule, {
      pickMarketplace: () => 'AMAZON',
      discoverByKeyword: {
        AMAZON: async () => {
          throw new Error('timeout ao buscar amazon.com.br');
        },
      },
    });

    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('ERROR');
    expect(log.marketplace).toBe('AMAZON');
    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(items.length).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts
```

Expected: FAIL — `discoverForRule` não aceita `pickMarketplace`/`discoverByKeyword`/`fetchByUrls` nas deps, e não sabe lidar com `MERCADOLIVRE`/`AMAZON` (hoje só cobre `SHOPEE`).

- [ ] **Step 3: Reescrever `apps/worker/src/automation/discovery.ts`**

```typescript
import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import {
  createShopeeAdapter,
  getTagAdapter,
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import type { MarketplaceKind, ProductData } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { createHash } from 'node:crypto';

const KEYWORD_CACHE_TTL_SEC = 15 * 60;

export interface DiscoveryDeps {
  searchShopee?: (creds: ShopeeCredentials, keyword: string) => Promise<ProductData[]>;
  /** Sorteio do marketplace (injetável em teste; padrão: aleatório real). */
  pickMarketplace?: (options: MarketplaceKind[]) => MarketplaceKind;
  /** Descoberta por keyword para ML/Amazon/Magalu (injetável em teste). */
  discoverByKeyword?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (keyword: string) => Promise<string[]>>>;
  /** Enriquecimento das URLs descobertas (injetável em teste; padrão: getTagAdapter real). */
  fetchByUrls?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (urls: string[]) => Promise<ProductData[]>>>;
}

function matchesFilters(
  p: ProductData,
  rule: Pick<AutomationRule, 'blockedKeywords' | 'minDiscountPct' | 'minPrice' | 'maxPrice'>,
): boolean {
  const title = p.title.toLowerCase();
  if (rule.blockedKeywords.some((k) => title.includes(k.toLowerCase()))) return false;
  if (rule.minDiscountPct != null && (p.discountPct ?? 0) < rule.minDiscountPct) return false;
  if (rule.minPrice != null && p.price < Number(rule.minPrice)) return false;
  if (rule.maxPrice != null && p.price > Number(rule.maxPrice)) return false;
  return true;
}

function cacheKey(marketplace: string, keyword: string) {
  return `automation-discover:${marketplace}:${createHash('sha1').update(keyword).digest('hex')}`;
}

async function cachedDiscoverUrls(
  marketplace: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
  discover: (keyword: string) => Promise<string[]>,
): Promise<string[]> {
  const key = cacheKey(marketplace, keyword);
  const cached = await getRedis().get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // cache corrompido: ignora e busca de novo
    }
  }
  const urls = await discover(keyword);
  await getRedis()
    .set(key, JSON.stringify(urls), 'EX', KEYWORD_CACHE_TTL_SEC)
    .catch(() => {});
  return urls;
}

async function queueEligibleProducts(rule: AutomationRule, marketplace: MarketplaceKind, results: ProductData[]) {
  const eligible = results.filter((p) => matchesFilters(p, rule));
  for (const p of eligible) {
    const product = await prisma.product.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId: rule.tenantId,
          source: p.source,
          externalId: p.externalId ?? '',
        },
      },
      update: {
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        raw: p.raw as object,
      },
      create: {
        tenantId: rule.tenantId,
        source: p.source,
        externalId: p.externalId ?? '',
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        originalUrl: p.originalUrl,
        raw: p.raw as object,
      },
    });
    const already = await prisma.automationQueueItem.findFirst({
      where: { ruleId: rule.id, productId: product.id },
    });
    if (already) continue;
    await prisma.automationQueueItem.create({
      data: { tenantId: rule.tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: false },
    });
    await prisma.automationLog.create({
      data: { tenantId: rule.tenantId, ruleId: rule.id, marketplace, action: 'DISCOVERED', productId: product.id },
    });
  }
}

async function discoverShopee(rule: AutomationRule, keyword: string, deps: DiscoveryDeps): Promise<ProductData[]> {
  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId: rule.tenantId, kind: 'SHOPEE' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
  const search =
    deps.searchShopee ??
    ((c: ShopeeCredentials, k: string) =>
      createShopeeAdapter().search!(c, {
        source: 'SHOPEE',
        mode: 'keyword',
        query: k,
        sort: 'DISCOUNT_DESC',
        limit: 20,
        topSellers: false,
        extraCommission: false,
      }));
  return search(creds, keyword);
}

const KEYWORD_DISCOVERERS = {
  MERCADOLIVRE: discoverMercadoLivreByKeyword,
  AMAZON: discoverAmazonByKeyword,
  MAGALU: discoverMagaluByKeyword,
} as const;

async function discoverScraped(
  marketplace: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
  deps: DiscoveryDeps,
): Promise<ProductData[]> {
  const discoverFn = deps.discoverByKeyword?.[marketplace] ?? KEYWORD_DISCOVERERS[marketplace];
  const urls = await cachedDiscoverUrls(marketplace, keyword, discoverFn);
  if (urls.length === 0) return [];
  const fetchFn = deps.fetchByUrls?.[marketplace] ?? ((u: string[]) => getTagAdapter(marketplace).fetchByUrls({}, u));
  return fetchFn(urls);
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (rule.marketplaces.length === 0) return;
  const pick = deps.pickMarketplace ?? ((options) => options[Math.floor(Math.random() * options.length)]!);
  const marketplace = pick(rule.marketplaces);

  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;

  let results: ProductData[];
  try {
    results =
      marketplace === 'SHOPEE'
        ? await discoverShopee(rule, keyword, deps)
        : await discoverScraped(marketplace, keyword, deps);
  } catch (e) {
    await prisma.automationLog.create({
      data: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        marketplace,
        action: 'ERROR',
        reason: e instanceof Error ? e.message : String(e),
      },
    });
    return;
  }

  await queueEligibleProducts(rule, marketplace, results);
}
```

- [ ] **Step 4: Rodar os testes de descoberta**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts
```

Expected: PASS em todos os casos (os 2 originais do Plano 1 — Shopee filtra bloqueados, sem duplicata — mais os 2 novos).

**Nota:** os testes do Plano 1 usavam `deps.searchShopee` diretamente; como `discoverForRule` agora só chama a Shopee quando `pick(rule.marketplaces)` sorteia `'SHOPEE'`, e a regra desses testes só tem `marketplaces: ['SHOPEE']`, o sorteio (`Math.random` real, sem mock) sempre vai cair em Shopee nesse caso — não precisa injetar `pickMarketplace` nesses 2 testes específicos. Confirme isso rodando os testes; se algum flakiness aparecer (não deveria, já que a lista tem 1 elemento só), ajuste esses 2 testes para injetar `pickMarketplace: () => 'SHOPEE'` explicitamente.

- [ ] **Step 5: Adicionar o teste do sorteio de marketplace no scheduler**

Adicionar a `apps/worker/test/automation-scheduler.test.ts`:

```typescript
it('sorteia 1 marketplace do pool da regra antes de descobrir', async () => {
  const rule = await prisma.automationRule.create({
    data: {
      tenantId,
      name: 'r-mix',
      enabled: true,
      marketplaces: ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU'],
      keywords: ['fone'],
      blockedKeywords: [],
      intervalMin: 5,
      sessionId,
      groupJids: ['g1@g.us'],
      templateId,
    },
  });

  const discoverCalls: string[] = [];
  const scheduler = new AutomationScheduler({
    enqueue: vi.fn(),
    discover: async (r) => {
      discoverCalls.push(r.id);
    },
  });
  await scheduler.reload();
  await scheduler.tick();

  // discover(rule) é chamado; quem decide QUAL marketplace é discoverForRule internamente
  // (Task 2 move o sorteio para dentro de discoverForRule, não do scheduler) — este teste
  // só confirma que o scheduler continua chamando discover exatamente 1 vez por rodada
  // mesmo com 4 marketplaces no pool da regra.
  expect(discoverCalls.length).toBe(1);
});
```

**Nota de design:** o sorteio de marketplace vive dentro de `discoverForRule` (Task 2, Step 3), não em `AutomationScheduler.dispatchNext` — o scheduler não precisa saber qual marketplace foi sorteado, só que a descoberta foi tentada uma vez por rodada (isso já era verdade no Plano 1). Esse teste existe para deixar explícito que múltiplos marketplaces no pool não fazem `discover` ser chamado mais de uma vez por rodada.

- [ ] **Step 6: Rodar o teste do scheduler**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts
```

Expected: PASS em todos os casos (os do Plano 1 + o novo).

- [ ] **Step 7: Rodar a suíte completa do worker**

```bash
cd apps/worker && npx vitest run
```

Expected: PASS, exceto as 2 falhas pré-existentes já conhecidas em `mirror-listener.test.ts` (não relacionadas).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/automation apps/worker/test
git commit -m "feat(worker): discoverForRule sorteia marketplace e cobre Mercado Livre/Amazon/Magalu

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: API + Web — habilitar Mercado Livre/Amazon/Magalu na criação de regra

**Files:**
- Modify: `apps/web/src/components/automations/rule-form.tsx`
- Test: nenhum novo (mudança de UI simples; validação já coberta pelos testes de `automationRuleCreateSchema` do Plano 1, que já aceita `marketplaces: string[]` com qualquer combinação de `MARKETPLACE_KINDS`)

**Interfaces:**
- Consome: `MARKETPLACE_KINDS` (`@afilados/shared`, já existe).
- Produz: formulário de criação de regra com múltiplos marketplaces selecionáveis.

- [ ] **Step 1: Trocar o array `MARKETS` fixo por checkboxes reais**

Em `apps/web/src/components/automations/rule-form.tsx`, o array `MARKETS` (hoje `enabled: false` para ML/Amazon/Magalu, usado só para exibir o rótulo "Em breve") passa a controlar seleção de verdade. Trocar o bloco:

```tsx
<div className="flex gap-2">
  {MARKETS.map((m) => (
    <span
      key={m.key}
      className={
        m.enabled
          ? 'rounded bg-orange-100 px-2 py-1 text-sm'
          : 'rounded bg-gray-100 px-2 py-1 text-sm text-gray-400'
      }
      title={m.enabled ? undefined : 'Em breve'}
    >
      {m.label}
    </span>
  ))}
</div>
```

Por (removendo a constante `MARKETS` com `enabled: false`, já que todos os 4 marketplaces agora funcionam):

```tsx
const ALL_MARKETS: { key: MarketplaceKind; label: string }[] = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
  { key: 'AMAZON', label: 'Amazon' },
  { key: 'MAGALU', label: 'Magalu' },
];
```

```tsx
const [marketplaces, setMarketplaces] = useState<MarketplaceKind[]>(['SHOPEE']);

function toggleMarketplace(kind: MarketplaceKind) {
  setMarketplaces((prev) =>
    prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
  );
}
```

```tsx
<div className="flex gap-2">
  {ALL_MARKETS.map((m) => (
    <button
      key={m.key}
      type="button"
      onClick={() => toggleMarketplace(m.key)}
      className={
        marketplaces.includes(m.key)
          ? 'rounded bg-orange-100 px-2 py-1 text-sm'
          : 'rounded bg-gray-100 px-2 py-1 text-sm text-gray-500'
      }
    >
      {m.label}
    </button>
  ))}
</div>
```

Importar `MarketplaceKind` de `@afilados/shared` no topo do arquivo.

- [ ] **Step 2: Usar o estado real no payload de criação**

Trocar, no `useApiMutation` de criação da regra:

```typescript
marketplaces: ['SHOPEE'],
```

Por:

```typescript
marketplaces,
```

E adicionar uma validação simples antes do `create.mutate()` (ou no `disabled` do botão de submit): não permitir submeter com `marketplaces.length === 0` — reaproveitar o padrão de `disabled={create.isPending}` já existente, trocando para `disabled={create.isPending || marketplaces.length === 0}`.

- [ ] **Step 3: Rodar o type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros novos.

- [ ] **Step 4: Testar manualmente**

```bash
docker compose up -d --build
```

Criar uma automação selecionando Mercado Livre + Amazon (sem Shopee), confirmar que a regra é criada e que, com o worker rodando, o campo "buscados hoje" eventualmente incrementa (pode levar até `intervalMin` minutos + o tempo do primeiro tick de 30s).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/automations/rule-form.tsx
git commit -m "feat(web): habilita seleção de Mercado Livre, Amazon e Magalu na criação de automação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Riscos específicos deste plano

1. **Seletores de extração dependem só de `parseProductUrl`, não de classes CSS.** Isso é deliberado (mais resistente a mudanças de layout do que raspar classe CSS), mas significa que se um marketplace mudar o **formato da URL** de produto (não só o layout visual), tanto este scraper quanto `parseProductUrl` (usado em várias outras partes do sistema) precisam ser atualizados juntos — não é um ponto de falha isolado desta feature.
2. **Páginas de busca podem exigir JS para renderizar resultados** (mencionado como risco já na spec §8.1). Task 1 pede explicitamente uma verificação manual contra o site real antes de dar a task por pronta — se qualquer um dos 3 vier vazio na prática, documente e considere abrir uma automation-específica para aquele marketplace ficar temporariamente restrito a inserção manual de link (já suportada desde o Plano 1), sem bloquear a entrega dos outros dois.
3. **Rate limit / bloqueio por IP**: sem o cache de 15 min (Task 2), múltiplas regras com keywords parecidas martelariam o mesmo marketplace repetidamente. O cache mitiga mas não elimina — se isso virar problema em produção, o próximo passo natural é um rate-limiter por domínio (mesmo padrão já usado no `product-enrich` worker: `limiter: { max: 6, duration: 10_000 }`), fora do escopo deste plano.

## Fora deste plano (Plano 3/3)

- Integração Awin (conexão, `awin-feed-sync`, `AWIN` como `MarketplaceKind`/`ProductSource`).
