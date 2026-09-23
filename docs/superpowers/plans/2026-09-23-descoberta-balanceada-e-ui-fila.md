# Descoberta balanceada por marketplace + UI da fila Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A descoberta automática passa a dividir o limite diário (`maxOffersPerDay`) em cota
igual entre os marketplaces selecionados na regra, redistribuindo a diferença de quem não
atingiu a cota para quem sobrou, e intercalando os itens descobertos na fila. A tela de
automações ganha: descrição do produto em várias linhas (sem cortar), linha clicável para
testar o link manualmente, contador "Enviados hoje", e um selo "Buscando..." enquanto a
automação está buscando produtos — visível mesmo se a página for recarregada no meio da busca.

**Architecture:** O worker (`discoverForRule`) busca em todos os marketplaces selecionados de
uma vez (com a mesma folga de resultados que já existia por marketplace), filtra pelos
critérios da regra, aplica cota + redistribuição, intercala e enfileira. Uma chave Redis com
TTL de segurança marca "buscando agora" por regra, lida pela API (`getAutomationStats`) e
espelhada por um evento de tempo real aditivo. O painel web consome os campos novos
(`isDiscovering`, `dispatchedToday` já existia mas não era exibido) e ajusta CSS/handlers na
`QueuePanel`/`RuleCard`.

**Tech Stack:** Node/TypeScript (worker, API Fastify), Redis (ioredis) para o sinal de
"buscando", Postgres/Prisma (sem mudança de schema), Next.js/React/TanStack Query (web).

## Global Constraints

- Cota base = `Math.floor(maxOffersPerDay / marketplaces.length)`; sobra da divisão não exata
  fica sem uso (não redistribuída) — spec §1/"Cota".
- Redistribuição de cota não faz nenhuma chamada extra às APIs dos marketplaces — usa só o que
  a busca com folga (~20 por marketplace, igual hoje) já trouxe — spec §1/"Busca com folga".
- Intercalação segue a ordem de `rule.marketplaces` (ordem em que o usuário selecionou) —
  spec §1/"Intercalação".
- Nenhuma mudança de schema Postgres — `isDiscovering` é campo aditivo computado via Redis, não
  coluna nova — spec/"Migração e compatibilidade".
- TTL de segurança da chave Redis de "buscando": 5 minutos (300s) — spec §2/"Selo Buscando...".

---

## Task 1: Shared — chave Redis do selo e evento de tempo real

**Files:**
- Modify: `packages/shared/src/automation.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/test/automation.test.ts`

**Interfaces:**
- Produces: `automationDiscoveringKey(ruleId: string): string` (nova função exportada),
  consumida pelo worker (Task 2) e pela API (Task 3). Novo membro do union `RealtimeEvent`:
  `{ type: 'automation.discovery'; ruleId: string; discovering: boolean }`, consumido pelo
  worker (Task 2, ao publicar) e pelo web (Task 4, `realtime.tsx`).

- [ ] **Step 1: Escrever o teste da chave (falhando)**

Em `packages/shared/test/automation.test.ts`, veja o padrão dos testes existentes (schemas
Zod) e adicione, num novo bloco `describe`, ao final do arquivo:

```typescript
describe('automationDiscoveringKey', () => {
  it('gera uma chave estável e única por regra', () => {
    expect(automationDiscoveringKey('rule-1')).toBe('automation-discovering:rule-1');
    expect(automationDiscoveringKey('rule-2')).not.toBe(automationDiscoveringKey('rule-1'));
  });
});
```

Adicione o import no topo do arquivo (junto aos demais imports de `../src/automation`):
`automationDiscoveringKey`.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd packages/shared && npx vitest run test/automation.test.ts
```

Expected: falha por `automationDiscoveringKey` não existir/não ser exportado.

- [ ] **Step 3: Implementar a função**

Em `packages/shared/src/automation.ts`, ao final do arquivo (depois de
`AutomationQueueOrderBody`), adicione:

```typescript
/**
 * Chave Redis que marca "esta regra está buscando produtos agora" — setada pelo worker no
 * início de discoverForRule e removida ao final (sucesso ou erro), com TTL de segurança para
 * nunca ficar travada caso o processo caia no meio da busca. Lida pela API (getAutomationStats)
 * para expor `isDiscovering` no painel.
 */
export function automationDiscoveringKey(ruleId: string): string {
  return `automation-discovering:${ruleId}`;
}
```

- [ ] **Step 4: Adicionar o evento de tempo real**

Em `packages/shared/src/events.ts`, no union `RealtimeEvent`, logo depois da linha
`| { type: 'automation.queue.updated'; ruleId: string }`, adicione:

```typescript
  | { type: 'automation.discovery'; ruleId: string; discovering: boolean }
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

```bash
cd packages/shared && npx vitest run test/automation.test.ts
```

Expected: passa.

- [ ] **Step 6: Typecheck**

```bash
cd /d/apps/afilados && pnpm --filter @afilados/shared typecheck
```

Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/automation.ts packages/shared/src/events.ts packages/shared/test/automation.test.ts
git commit -m "feat(shared): chave Redis e evento de tempo real para o selo de descoberta em andamento

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Worker — descoberta balanceada com redistribuição e intercalação

**Files:**
- Modify: `apps/worker/src/automation/discovery.ts`
- Modify: `apps/worker/test/automation-discovery.test.ts`

**Interfaces:**
- Consumes: `automationDiscoveringKey` e o tipo `RealtimeEvent` (com o membro
  `automation.discovery`) de `@afilados/shared` (Task 1); `publishEvent(tenantId, event)` de
  `../lib/events` (já existe, usado por outros processors do worker — ver
  `apps/worker/src/processors/mirror-message.ts` para o padrão de uso).
- Produces: nenhuma interface nova exportada — `discoverForRule(rule, deps?)` mantém a mesma
  assinatura pública; internamente passa a buscar em todos os marketplaces da regra em vez de
  um só.

- [ ] **Step 1: Escrever os testes novos (falhando)**

Em `apps/worker/test/automation-discovery.test.ts`, adicione um novo `describe` ao final do
arquivo (depois do `describe('discoverForRule (AliExpress)', ...)`, antes do fim do arquivo):

```typescript
describe('discoverForRule (cota balanceada entre marketplaces)', () => {
  async function makeRule(overrides: {
    marketplaces: ('SHOPEE' | 'AWIN')[];
    maxOffersPerDay: number;
    keywords?: string[];
  }) {
    return prisma.automationRule.create({
      data: {
        tenantId,
        name: `quota-${Date.now()}-${Math.random()}`,
        marketplaces: overrides.marketplaces,
        keywords: overrides.keywords ?? ['fone'],
        blockedKeywords: [],
        maxOffersPerDay: overrides.maxOffersPerDay,
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: `sq${Math.random()}` } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: `tq${Math.random()}`, body: 'x' } })).id,
      },
    });
  }

  async function seedAwinProducts(count: number, titlePrefix = 'Fone Awin') {
    for (let i = 0; i < count; i++) {
      await prisma.awinCatalogProduct.create({
        data: {
          tenantId,
          feedId: 'f-quota',
          externalId: `awin-quota-${Date.now()}-${i}-${Math.random()}`,
          title: `${titlePrefix} ${i}`,
          price: 50,
          deepLink: `https://www.awin1.com/cread.php?x=quota-${i}`,
          raw: {},
        },
      });
    }
  }

  function shopeeResults(count: number, titlePrefix = 'Fone Shopee'): any[] {
    return Array.from({ length: count }, (_, i) => ({
      source: 'SHOPEE' as const,
      externalId: `shopee-quota-${Date.now()}-${i}-${Math.random()}`,
      title: `${titlePrefix} ${i}`,
      price: 40,
      images: [`https://x/sq${i}.png`],
      shipping: 'FREE' as const,
      originalUrl: `https://shopee.com.br/p/quota-${i}`,
      raw: {},
    }));
  }

  it('cota exata quando os dois marketplaces têm produtos suficientes', async () => {
    const rule = await makeRule({ marketplaces: ['SHOPEE', 'AWIN'], maxOffersPerDay: 4 });
    await seedAwinProducts(3);

    await discoverForRule(rule, { searchShopee: async () => shopeeResults(3) });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(4); // floor(4/2)=2 de cada
    const bySource = items.reduce<Record<string, number>>((acc, i) => {
      const s = i.product!.source;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySource.SHOPEE).toBe(2);
    expect(bySource.AWIN).toBe(2);
  });

  it('redistribui a diferença quando um marketplace não atinge a cota', async () => {
    const rule = await makeRule({ marketplaces: ['SHOPEE', 'AWIN'], maxOffersPerDay: 6 });
    await seedAwinProducts(5);

    await discoverForRule(rule, { searchShopee: async () => shopeeResults(1) });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    // cota base 3 cada; Shopee só tem 1 (shortfall 2); Awin tem sobra (5-3=2) que cobre o shortfall
    expect(items.length).toBe(6);
    const bySource = items.reduce<Record<string, number>>((acc, i) => {
      const s = i.product!.source;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySource.SHOPEE).toBe(1);
    expect(bySource.AWIN).toBe(5);
  });

  it('marketplace sem nenhum resultado tem a cota inteira redistribuída', async () => {
    const rule = await makeRule({ marketplaces: ['SHOPEE', 'AWIN'], maxOffersPerDay: 4 });
    await seedAwinProducts(8);

    await discoverForRule(rule, { searchShopee: async () => [] });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(4);
    expect(items.every((i) => i.product!.source === 'AWIN')).toBe(true);
  });

  it('sobra da divisão não exata fica sem uso', async () => {
    const rule = await makeRule({ marketplaces: ['SHOPEE', 'AWIN'], maxOffersPerDay: 7 });
    await seedAwinProducts(3);

    await discoverForRule(rule, { searchShopee: async () => shopeeResults(3) });

    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    // floor(7/2)=3 cada = 6 total, não 7
    expect(items.length).toBe(6);
  });

  it('intercala os itens na fila alternando o marketplace, na ordem de rule.marketplaces', async () => {
    const rule = await makeRule({ marketplaces: ['SHOPEE', 'AWIN'], maxOffersPerDay: 4 });
    await seedAwinProducts(2);

    await discoverForRule(rule, { searchShopee: async () => shopeeResults(2) });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      orderBy: { position: 'asc' },
      include: { product: true },
    });
    expect(items.map((i) => i.product!.source)).toEqual(['SHOPEE', 'AWIN', 'SHOPEE', 'AWIN']);
  });

  it('marca e remove a chave Redis de "buscando" mesmo quando uma busca falha', async () => {
    const { getRedis } = await import('../src/lib/redis');
    const { automationDiscoveringKey } = await import('@afilados/shared');
    const rule = await makeRule({ marketplaces: ['SHOPEE'], maxOffersPerDay: 4 });
    const key = automationDiscoveringKey(rule.id);

    let sawKeySetDuringSearch = false;
    await discoverForRule(rule, {
      searchShopee: async () => {
        sawKeySetDuringSearch = (await getRedis().exists(key)) === 1;
        throw new Error('falha simulada');
      },
    });

    expect(sawKeySetDuringSearch).toBe(true);
    expect(await getRedis().exists(key)).toBe(0);
  });
});
```

- [ ] **Step 2: Remover os usos obsoletos de `pickMarketplace` nos testes existentes**

No mesmo arquivo, remova as 3 linhas `pickMarketplace: () => '...',` (o parâmetro deixa de
existir — a descoberta não sorteia mais um marketplace único). São exatamente estas três
ocorrências:

- Linha ~245, no teste `'descobre produto do Mercado Livre quando discoverByKeyword é
  injetado...'`: remova a linha `pickMarketplace: () => 'MERCADOLIVRE',`.
- Linha ~273, no teste `'loga ERROR e não derruba a regra quando o scraper falha'`: remova a
  linha `pickMarketplace: () => 'AMAZON',`.
- Linha ~306, no teste `'loga ERROR (não apenas silêncio) quando a busca do ML retorna
  vazio...'`: remova a linha `pickMarketplace: () => 'MERCADOLIVRE',`.

Cada um desses objetos de deps fica só com `discoverByKeyword` (e `fetchByUrls` quando já
tinha).

- [ ] **Step 3: Rodar os testes e confirmar que os novos falham, os existentes ainda passam por enquanto**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts 2>&1 | tail -60
```

Expected: os 6 testes novos falham (comportamento antigo ainda no lugar — sorteia um
marketplace só, não distribui cota); os testes pré-existentes continuam passando (a remoção de
`pickMarketplace` não quebra nada, já que o campo era opcional).

- [ ] **Step 4: Reescrever `discovery.ts`**

Em `apps/worker/src/automation/discovery.ts`, faça as seguintes mudanças:

**4a.** No topo do arquivo, atualize os imports (adicione `automationDiscoveringKey` ao import
de `@afilados/shared`, e adicione o import de `publishEvent`):

```typescript
import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import {
  createShopeeAdapter,
  getAliexpressAdapter,
  getTagAdapter,
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
  type AliexpressCredentials,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import {
  type MarketplaceKind,
  type ProductData,
  mapAwinCatalogRowToProductData,
  automationDiscoveringKey,
} from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { publishEvent } from '../lib/events';
import { createHash } from 'node:crypto';
import { loadTagCredentials } from '../lib/marketplace-credentials';

const KEYWORD_CACHE_TTL_SEC = 15 * 60;
/** TTL de segurança do selo "buscando" — evita ficar travado para sempre se o worker cair no meio da busca. */
const DISCOVERING_TTL_SEC = 5 * 60;
```

**4b.** No `DiscoveryDeps`, remova o campo `pickMarketplace` (linha `pickMarketplace?: (options:
MarketplaceKind[]) => MarketplaceKind;`) — não é mais usado.

**4c.** Substitua a função `queueEligibleProducts` inteira (do `async function
queueEligibleProducts(...)` até o `}` que a fecha) por esta versão, que enfileira UM produto já
filtrado (o filtro agora acontece antes, na nova `discoverForRule`):

```typescript
async function queueDiscoveredProduct(rule: AutomationRule, marketplace: MarketplaceKind, p: ProductData) {
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
  if (already) return;
  await prisma.automationQueueItem.create({
    data: { tenantId: rule.tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: false },
  });
  await prisma.automationLog.create({
    data: { tenantId: rule.tenantId, ruleId: rule.id, marketplace, action: 'DISCOVERED', productId: product.id },
  });
}
```

**4d.** Substitua a função `discoverForRule` inteira (do `export async function
discoverForRule(...)` até o final do arquivo) por:

```typescript
async function searchOneMarketplace(
  marketplace: MarketplaceKind,
  rule: AutomationRule,
  keyword: string,
  deps: DiscoveryDeps,
): Promise<ProductData[]> {
  if (marketplace === 'SHOPEE') return discoverShopee(rule, keyword, deps);
  if (marketplace === 'ALIEXPRESS') return discoverAliexpress(rule, keyword, deps);
  if (marketplace === 'AWIN') return discoverAwin(rule, keyword);
  return discoverScraped(marketplace, keyword, rule, deps);
}

/**
 * Cota base por marketplace = floor(maxOffersPerDay / nº de marketplaces selecionados); a sobra
 * da divisão não exata fica sem uso. Quando um marketplace não atinge sua cota (poucos
 * elegíveis, erro ou bloqueio anti-bot), a diferença é redistribuída em rodízio pelos
 * marketplaces que sobraram itens além da própria cota — sem nenhuma chamada extra às APIs, só
 * usando o que a busca com folga (~20 por marketplace) já trouxe.
 */
function distributeWithQuota(
  marketplaces: MarketplaceKind[],
  resultsByMarketplace: Map<MarketplaceKind, ProductData[]>,
  quota: number,
): Map<MarketplaceKind, ProductData[]> {
  const taken = new Map<MarketplaceKind, ProductData[]>();
  for (const m of marketplaces) {
    const results = resultsByMarketplace.get(m) ?? [];
    taken.set(m, results.slice(0, Math.min(quota, results.length)));
  }
  let shortfall = 0;
  for (const m of marketplaces) shortfall += Math.max(0, quota - taken.get(m)!.length);

  let progressed = true;
  while (shortfall > 0 && progressed) {
    progressed = false;
    for (const m of marketplaces) {
      if (shortfall <= 0) break;
      const results = resultsByMarketplace.get(m) ?? [];
      const current = taken.get(m)!;
      if (current.length < results.length) {
        taken.set(m, [...current, results[current.length]!]);
        shortfall--;
        progressed = true;
      }
    }
  }
  return taken;
}

/** Intercala os itens já decididos por marketplace, um de cada vez, na ordem de rule.marketplaces. */
function interleaveByMarketplace(
  marketplaces: MarketplaceKind[],
  taken: Map<MarketplaceKind, ProductData[]>,
): { marketplace: MarketplaceKind; product: ProductData }[] {
  const cursors = new Map<MarketplaceKind, number>(marketplaces.map((m) => [m, 0]));
  const out: { marketplace: MarketplaceKind; product: ProductData }[] = [];
  const total = [...taken.values()].reduce((sum, arr) => sum + arr.length, 0);
  while (out.length < total) {
    for (const m of marketplaces) {
      const items = taken.get(m)!;
      const cursor = cursors.get(m)!;
      if (cursor < items.length) {
        out.push({ marketplace: m, product: items[cursor]! });
        cursors.set(m, cursor + 1);
      }
    }
  }
  return out;
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (rule.marketplaces.length === 0) return;
  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;

  const quota = Math.floor(rule.maxOffersPerDay / rule.marketplaces.length);
  if (quota <= 0) return;

  const discoveringKey = automationDiscoveringKey(rule.id);
  await getRedis().set(discoveringKey, '1', 'EX', DISCOVERING_TTL_SEC).catch(() => {});
  await publishEvent(rule.tenantId, { type: 'automation.discovery', ruleId: rule.id, discovering: true }).catch(
    () => {},
  );

  try {
    const resultsByMarketplace = new Map<MarketplaceKind, ProductData[]>();
    for (const marketplace of rule.marketplaces) {
      let raw: ProductData[];
      try {
        raw = await searchOneMarketplace(marketplace, rule, keyword, deps);
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
        raw = [];
      }
      resultsByMarketplace.set(marketplace, raw.filter((p) => matchesFilters(p, rule, keyword)));
    }

    const taken = distributeWithQuota(rule.marketplaces, resultsByMarketplace, quota);
    const interleaved = interleaveByMarketplace(rule.marketplaces, taken);
    for (const { marketplace, product } of interleaved) {
      await queueDiscoveredProduct(rule, marketplace, product);
    }
  } finally {
    await getRedis().del(discoveringKey).catch(() => {});
    await publishEvent(rule.tenantId, { type: 'automation.discovery', ruleId: rule.id, discovering: false }).catch(
      () => {},
    );
  }
}
```

Note que as funções `discoverShopee`, `discoverAliexpress`, `discoverAwin`,
`KEYWORD_DISCOVERERS`, `discoverScraped`, `matchesFilters`, `matchesKeyword`, `normalizeText`,
`cacheKey`, `cachedDiscoverUrls` **não mudam** — só a orquestração no final do arquivo.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts 2>&1 | tail -80
```

Expected: todos os testes do arquivo passam (os 6 novos + os pré-existentes, incluindo os que
tiveram `pickMarketplace` removido).

- [ ] **Step 6: Rodar a suíte do scheduler para garantir que nada quebrou na integração**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts 2>&1 | tail -40
```

Expected: mesmo resultado documentado em sessões anteriores — 6/8 passando, com exatamente os
2 testes pré-existentes já conhecidos falhando (`despacha item manual antes de descobrir
automaticamente` e `pula produto inelegível (pendingEnrich) e loga SKIPPED sem despachar`,
causa raiz documentada: `AutomationScheduler.reload()` sem filtro de tenant, contaminado pelo
banco de dev compartilhado — não é escopo deste plano corrigir). Se aparecer qualquer falha
diferente dessas duas, pare e investigue antes de prosseguir.

- [ ] **Step 7: Typecheck**

```bash
cd /d/apps/afilados && pnpm --filter @afilados/worker typecheck
```

Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/automation/discovery.ts apps/worker/test/automation-discovery.test.ts
git commit -m "feat(worker): descoberta balanceada por marketplace com redistribuição de cota e intercalação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: API — `isDiscovering` nas estatísticas da automação

**Files:**
- Modify: `apps/api/src/lib/automations.ts`
- Modify: `apps/api/test/automations.test.ts`

**Interfaces:**
- Consumes: `automationDiscoveringKey` de `@afilados/shared` (Task 1); `getRedis` de
  `../lib/redis` (já existe no pacote API).
- Produces: `AutomationStats` (interface local deste arquivo, consumida por
  `apps/api/src/routes/automations.ts:62` e pelo tipo espelhado no web — Task 4) ganha o campo
  `isDiscovering: boolean`.

- [ ] **Step 1: Escrever o teste (falhando)**

Em `apps/api/test/automations.test.ts`, logo depois do teste `'lista regras com estatísticas
derivadas do log'` (perto do início do arquivo, ver em volta da linha 52-65), adicione:

```typescript
  it('GET /automations expõe isDiscovering (true enquanto a chave Redis existe)', async () => {
    const { getRedis } = await import('../src/lib/redis');
    const { automationDiscoveringKey } = await import('@afilados/shared');
    const key = automationDiscoveringKey(ruleId);

    const before = await app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie } });
    const ruleBefore = before.json().find((r: { id: string }) => r.id === ruleId);
    expect(ruleBefore.stats.isDiscovering).toBe(false);

    await getRedis().set(key, '1', 'EX', 60);
    const during = await app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie } });
    const ruleDuring = during.json().find((r: { id: string }) => r.id === ruleId);
    expect(ruleDuring.stats.isDiscovering).toBe(true);

    await getRedis().del(key);
    const after = await app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie } });
    const ruleAfter = after.json().find((r: { id: string }) => r.id === ruleId);
    expect(ruleAfter.stats.isDiscovering).toBe(false);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/api && npx vitest run test/automations.test.ts 2>&1 | tail -30
```

Expected: falha (`ruleBefore.stats.isDiscovering` é `undefined`, não `false`).

- [ ] **Step 3: Implementar**

Substitua o conteúdo inteiro de `apps/api/src/lib/automations.ts` por:

```typescript
import type { TenantClient } from '@afilados/db';
import { automationDiscoveringKey } from '@afilados/shared';
import { getRedis } from './redis';

export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
  isDiscovering: boolean;
}

export async function getAutomationStats(db: TenantClient, ruleId: string): Promise<AutomationStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [freshCount, discoveredToday, dispatchedToday, lastDispatch, discoveringFlag] = await Promise.all([
    db.automationQueueItem.count({ where: { ruleId, status: 'PENDING' } }),
    db.automationLog.count({ where: { ruleId, action: 'DISCOVERED', createdAt: { gte: startOfDay } } }),
    db.automationLog.count({ where: { ruleId, action: 'DISPATCHED', createdAt: { gte: startOfDay } } }),
    db.automationLog.findFirst({ where: { ruleId, action: 'DISPATCHED' }, orderBy: { createdAt: 'desc' } }),
    getRedis().exists(automationDiscoveringKey(ruleId)),
  ]);

  return {
    freshCount,
    discoveredToday,
    dispatchedToday,
    lastDispatchedAt: lastDispatch?.createdAt.toISOString() ?? null,
    isDiscovering: discoveringFlag === 1,
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
cd apps/api && npx vitest run test/automations.test.ts
```

Expected: todos passam, incluindo o novo.

- [ ] **Step 5: Typecheck**

```bash
cd /d/apps/afilados && pnpm --filter @afilados/api typecheck
```

Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/automations.ts apps/api/test/automations.test.ts
git commit -m "feat(api): expõe isDiscovering nas estatísticas da automação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Web — painel responsivo, linha clicável, "enviados hoje" e selo "Buscando..."

**Files:**
- Modify: `apps/web/src/lib/realtime.tsx`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/components/automations/rule-card.tsx`
- Modify: `apps/web/src/components/automations/queue-panel.tsx`
- Modify: `apps/web/test/queue-panel.test.tsx`

**Interfaces:**
- Consumes: `RealtimeEvent` de `@afilados/shared` (com o membro `automation.discovery`, Task
  1); `GET /automations` agora devolve `stats.isDiscovering` e já devolvia
  `stats.dispatchedToday` (Task 3, mas esse campo já existia antes deste plano).
- Produces: nenhuma interface nova consumida por outro arquivo.

- [ ] **Step 1: Invalidar `['automations']` em qualquer evento `automation.*`**

Em `apps/web/src/lib/realtime.tsx`, dentro do `useEffect` de `RealtimeProvider`, logo depois do
bloco:

```typescript
      if (e.type.startsWith('mirror.')) {
        void qc.invalidateQueries({ queryKey: ['mirror'] });
      }
```

adicione:

```typescript
      if (e.type.startsWith('automation.')) {
        void qc.invalidateQueries({ queryKey: ['automations'] });
      }
```

- [ ] **Step 2: Adicionar `isDiscovering` ao tipo `AutomationStats` do web**

Em `apps/web/src/lib/types.ts`, na interface `AutomationStats` (ver em volta da linha 231),
adicione o campo:

```typescript
export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
  isDiscovering: boolean;
}
```

- [ ] **Step 3: Atualizar `queue-panel.tsx` — sem corte de texto, linha clicável, layout responsivo**

Substitua o conteúdo inteiro de `apps/web/src/components/automations/queue-panel.tsx` por:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAutomationQueue } from '@/lib/queries';
import type { AutomationQueueItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const MARKETPLACE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
  ALIEXPRESS: 'AliExpress',
  MANUAL: 'Manual',
};

function marketplaceLabel(marketplace: string | null): string {
  if (!marketplace) return '—';
  return MARKETPLACE_LABELS[marketplace] ?? marketplace;
}

/** Link original do item, para teste manual — produto usa originalUrl, cupom usa sourceUrl (pode não existir). */
function itemUrl(it: AutomationQueueItem): string | null {
  if (it.kind === 'PRODUCT') return it.product?.originalUrl ?? null;
  return it.coupon?.sourceUrl ?? null;
}

export function QueuePanel({ ruleId }: { ruleId: string }) {
  const { data: items } = useAutomationQueue(ruleId);
  const [linkUrl, setLinkUrl] = useState('');
  const [order, setOrder] = useState<AutomationQueueItem[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (items) setOrder(items);
  }, [items]);

  const removeItem = useApiMutation(
    (itemId: string) => apiFetch(`/automations/${ruleId}/queue/${itemId}`, { method: 'DELETE' }),
    { invalidate: [['automations', ruleId, 'queue']], success: 'Item removido' },
  );
  const addLink = useApiMutation(
    () => apiFetch(`/automations/${ruleId}/queue/link`, { method: 'POST', json: { url: linkUrl } }),
    {
      invalidate: [['automations', ruleId, 'queue']],
      success: 'Link adicionado à fila',
      onSuccess: () => setLinkUrl(''),
    },
  );

  // Reordenação tem UI otimista (a lista já muda visualmente ao soltar) — em caso de erro,
  // reverte para a última lista confirmada pelo servidor (`items`) em vez de deixar a UI
  // divergente do banco. useApiMutation não dá esse gancho de rollback, então usa useMutation
  // direto aqui, mantendo o mesmo toast de erro que useApiMutation usaria.
  const reorder = useMutation({
    mutationFn: (itemIds: string[]) =>
      apiFetch(`/automations/${ruleId}/queue/order`, { method: 'PATCH', json: { itemIds } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automations', ruleId, 'queue'] });
    },
    onError: (err) => {
      setOrder(items ?? []);
      toast.error(err instanceof ApiClientError ? err.message : 'Erro ao reordenar a fila');
    },
  });

  function handleDrop(dropIndex: number) {
    const dragIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved!);
    setOrder(next);
    reorder.mutate(next.map((i) => i.id));
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Programado para disparar</p>
      <ul className="space-y-1">
        {order.map((it, index) => {
          const url = itemUrl(it);
          return (
            <li
              key={it.id}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              onClick={() => {
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
              }}
              title={url ? 'Clique para abrir o link e testar manualmente' : undefined}
              className={cn(
                'flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm transition-colors',
                url && 'cursor-pointer hover:border-brand/50',
              )}
            >
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <GripVertical
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden
                  onClick={(e) => e.stopPropagation()}
                />
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                  {marketplaceLabel(it.marketplace)}
                </Badge>
                {it.manual && (
                  <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                    manual
                  </Badge>
                )}
                <span className="min-w-0 whitespace-normal break-words">
                  {it.kind === 'PRODUCT' ? it.product?.title : `Cupom ${it.coupon?.code}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem.mutate(it.id);
                }}
              >
                Remover
              </Button>
            </li>
          );
        })}
        {order.length === 0 && (
          <li className="text-sm text-muted-foreground">Nada na fila ainda.</li>
        )}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addLink.mutate();
        }}
      >
        <Input
          className="min-w-0 flex-1"
          placeholder="Colar link de produto…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!linkUrl || addLink.isPending}>
          Adicionar link
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Atualizar `rule-card.tsx` — cabeçalho responsivo, "Enviados hoje", selo "Buscando..."**

Substitua o conteúdo inteiro de `apps/web/src/components/automations/rule-card.tsx` por:

```tsx
'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { AutomationRule } from '@/lib/types';
import { QueuePanel } from './queue-panel';

export function RuleCard({ rule }: { rule: AutomationRule }) {
  const [open, setOpen] = useState(false);
  const toggle = useApiMutation(
    (enabled: boolean) =>
      apiFetch(`/automations/${rule.id}/toggle`, { method: 'POST', json: { enabled } }),
    { invalidate: [['automations']] },
  );
  const remove = useApiMutation(
    () => apiFetch(`/automations/${rule.id}`, { method: 'DELETE' }),
    { invalidate: [['automations']], success: 'Automação excluída' },
  );

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{rule.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {rule.keywords.join(', ')} · a cada {rule.intervalMin}min · limite{' '}
              {rule.maxOffersPerDay}/dia
            </p>
          </div>
        </button>
        <Button
          variant={rule.enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggle.mutate(!rule.enabled)}
        >
          {rule.enabled ? 'Ligada' : 'Desligada'}
        </Button>
        <Button
          variant="destructive"
          size="icon-sm"
          aria-label="Excluir automação"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm(`Excluir a automação "${rule.name}"? Essa ação não pode ser desfeita.`)) {
              remove.mutate(undefined);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <div className="border-t border-border p-3 pt-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Frescos p/ enviar: {rule.stats.freshCount}</span>
            <span>Buscados hoje: {rule.stats.discoveredToday}</span>
            <span>Enviados hoje: {rule.stats.dispatchedToday}</span>
            <span>
              Último disparo:{' '}
              {rule.stats.lastDispatchedAt
                ? new Date(rule.stats.lastDispatchedAt).toLocaleString('pt-BR')
                : 'Nunca'}
            </span>
            {rule.stats.isDiscovering && (
              <span className="flex items-center gap-1 text-brand">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Buscando...
              </span>
            )}
          </div>
          <QueuePanel ruleId={rule.id} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Escrever/atualizar os testes de componente**

Em `apps/web/test/queue-panel.test.tsx`, no fixture `items` já existente (o array com os itens
`q1` PRODUCT e `q2` COUPON), confirme que `q1.product.originalUrl` já é
`'https://shopee.com.br/p/1'` (já é, no fixture atual) — se não for, ajuste para esse valor.
Adicione, dentro do `describe('QueuePanel', ...)`, um novo teste:

```typescript
  it('clicar na linha do item abre o link original em nova aba', async () => {
    apiFetchMock.mockResolvedValue(items);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();
    const title = await screen.findByText('Fone Bluetooth');
    fireEvent.click(title.closest('li')!);
    expect(openSpy).toHaveBeenCalledWith(
      'https://shopee.com.br/p/1',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });
```

Ajuste o import do topo do arquivo para incluir `fireEvent` de `@testing-library/react` (some
ao `import { render, screen } from '@testing-library/react';` existente, tornando-o `import {
render, screen, fireEvent } from '@testing-library/react';`).

Crie também `apps/web/test/rule-card.test.tsx` (não existe ainda), cobrindo o selo "Buscando..."
e "Enviados hoje":

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleCard } from '@/components/automations/rule-card';
import type { AutomationRule } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const baseRule: AutomationRule = {
  id: 'r1',
  name: 'Ofertas',
  enabled: true,
  marketplaces: ['SHOPEE'],
  keywords: ['fone'],
  blockedKeywords: [],
  minDiscountPct: null,
  minPrice: null,
  maxPrice: null,
  maxOffersPerDay: 20,
  intervalMin: 60,
  sessionId: 's1',
  groupJids: ['g@g.us'],
  templateId: 't1',
  mediaMode: 'IMAGE',
  createdAt: new Date().toISOString(),
  stats: {
    freshCount: 3,
    discoveredToday: 5,
    dispatchedToday: 2,
    lastDispatchedAt: null,
    isDiscovering: false,
  },
};

function renderCard(rule: AutomationRule) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RuleCard rule={rule} />
    </QueryClientProvider>,
  );
}

describe('RuleCard', () => {
  it('mostra "Enviados hoje" com o valor de dispatchedToday', () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard(baseRule);
    const button = screen.getByRole('button', { expanded: false });
    button.click();
    expect(screen.getByText('Enviados hoje: 2')).toBeInTheDocument();
  });

  it('mostra o selo "Buscando..." quando isDiscovering é true', () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard({ ...baseRule, stats: { ...baseRule.stats, isDiscovering: true } });
    const button = screen.getByRole('button', { expanded: false });
    button.click();
    expect(screen.getByText('Buscando...')).toBeInTheDocument();
  });

  it('não mostra o selo "Buscando..." quando isDiscovering é false', () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard(baseRule);
    const button = screen.getByRole('button', { expanded: false });
    button.click();
    expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Rodar os testes**

```bash
cd apps/web && npx vitest run test/queue-panel.test.tsx test/rule-card.test.tsx
```

Expected: todos passam.

- [ ] **Step 7: Typecheck**

```bash
cd /d/apps/afilados && pnpm --filter @afilados/web typecheck
```

Expected: sem erros novos.

- [ ] **Step 8: Verificação manual no navegador**

```bash
docker compose build web api worker && docker compose up -d web api worker
```

Abra o painel de automações, confirme visualmente: (a) título de produto longo quebra em
várias linhas em vez de cortar; (b) em largura estreita (DevTools em modo mobile), nada gera
scroll horizontal; (c) clicar numa linha da fila (fora do botão Remover) abre o link em nova
aba; (d) "Enviados hoje" aparece com o número certo; (e) ligue uma automação com fila vazia e
observe o selo "Buscando..." aparecer brevemente enquanto o worker descobre produtos, e sumir
ao terminar.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/realtime.tsx apps/web/src/lib/types.ts apps/web/src/components/automations/rule-card.tsx apps/web/src/components/automations/queue-panel.tsx apps/web/test/queue-panel.test.tsx apps/web/test/rule-card.test.tsx
git commit -m "feat(web): fila responsiva com linha clicável, enviados hoje e selo de busca em andamento

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificação final

- [ ] Rodar a suíte completa e confirmar que só as falhas pré-existentes documentadas
  aparecem (2 no `automation-scheduler.test.ts`, mais as já conhecidas e não relacionadas em
  `wa.test.ts`/`batch-form.test.tsx`):

```bash
cd /d/apps/afilados
DATABASE_URL="postgresql://afilados:afilados@localhost:5434/afilados" pnpm -r test 2>&1 | tail -120
```

- [ ] Rebuild e subida dos containers para teste end-to-end:

```bash
docker compose build api worker web && docker compose up -d api worker web
```

- [ ] Fluxo manual completo: ligar uma automação com 2+ marketplaces selecionados e limite
  diário definido, observar o selo "Buscando...", conferir no painel que os itens descobertos
  alternam de marketplace na ordem da fila, e que a soma bate com
  `floor(limite / nº marketplaces) * nº marketplaces`.
