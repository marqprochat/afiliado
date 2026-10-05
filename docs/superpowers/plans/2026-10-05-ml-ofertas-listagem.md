# Ofertas do ML por listagem + links de afiliado em lote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buscar produtos do Mercado Livre pelas páginas de listagem de ofertas (a busca por palavra-chave é bloqueada) e gerar links de afiliado `meli.la` em lote, com fallback para o método atual e aviso do erro no card do ML.

**Architecture:** Um parser puro (cheerio) lê os cards `poly-card` das listagens `/ofertas` e `/mais-vendidos`; `fetchMlListing` pagina e, se cair na verificação anti-bot, repete com os cookies da sessão sincronizada. A API expõe isso em `POST /products/search` (`mode: 'listing'`). Os links saem de `generateOfficialMlLinks` (lotes de 20); um job `ml-links-prewarm` no worker gera os links ao salvar na fila/lote, cai no método individual quando o lote falha e grava o erro no Redis, que a tela de Marketplaces mostra.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), pnpm workspaces, cheerio 1.x, zod, Fastify, BullMQ + ioredis, Prisma, Next.js 15 + React Query, vitest (+ Testing Library no web).

Spec: `docs/superpowers/specs/2026-10-05-ml-ofertas-listagem-design.md`.

## Global Constraints

- Branch de trabalho: `feat/ml-ofertas-listagem` (já criado). Nunca commitar na `main`.
- Mensagens para o usuário, erros e comentários em **português** (como no resto do repositório). Código em inglês/português misto seguindo o arquivo vizinho.
- Sem dependências novas (`cheerio`, `zod`, `bullmq` já existem).
- Listagem: **48 cards por página, no máximo 5 páginas**, pausa **1–2 s** entre páginas, timeout de 15 s por página. URL colada só `https:` e host `mercadolivre.com.br` ou `*.mercadolivre.com.br`.
- Links em lote: **20 URLs por chamada** ao `createLink`, pausa de 2,5 s entre lotes, um acesso ao painel (CSRF) por execução.
- Cache de link no Redis: chave `ml-aff-link:<tenantId>:<tag|default>:<sha1(originalUrl)>`, TTL **24 h**, só links `https://meli.la/…`.
- Erro do método 1: chave `ml-links-batch:last-error:<tenantId>` (sem TTL), valor JSON `{ at, message, urls, recoveredByFallback }`; apagada quando uma execução termina sem nenhuma URL pendente.
- `ML_SESSION_EXPIRED` **não** aciona o método 2 (falharia igual).
- `generateOfficialMlLink` (método atual) mantém assinatura e comportamento; só ganha `tag` opcional.
- Tipos: com `exactOptionalPropertyTypes`, nunca atribua `undefined` a propriedade opcional; use `...(x ? { x } : {})` ou declare `?: T | undefined`.
- Segredos/cookies nunca saem da API (`publicConnection` só expõe metadados).
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` e roda `pnpm exec prettier --write` nos arquivos tocados antes.
- Validação final obrigatória no Docker (regra do projeto): subir/rebuildar e conferir lá antes de dar como concluído.

## Pré-requisitos (uma vez)

Testes da API e do worker usam Postgres (porta 5434) e Redis (6379) reais:

```bash
docker compose up -d --wait postgres redis
pnpm install
```

Se o sistema completo do Docker já estiver de pé, pare o worker enquanto roda os testes da API (os testes de enfileiramento da Task 7 leem a fila e um worker real consumiria os jobs):

```bash
docker compose stop worker
```

Comandos de teste usados abaixo (rodam do diretório raiz `D:\apps\afilados`):

- `pnpm --filter @afilados/shared exec vitest run test/<arquivo>`
- `pnpm --filter @afilados/marketplaces exec vitest run test/<arquivo>`
- `pnpm --filter @afilados/api exec vitest run test/<arquivo>`
- `pnpm --filter @afilados/worker exec vitest run test/<arquivo>`
- `pnpm --filter @afilados/web exec vitest run test/<arquivo>`

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `packages/shared/src/search.ts` | modificar | modo `listing` + `mlListing` no schema de busca |
| `packages/shared/src/marketplaces.ts` | modificar | `ML_DEAL_CATEGORIES` (categorias raiz do MLB) |
| `packages/shared/src/queues.ts` | modificar | `QUEUE_ML_LINKS_PREWARM` + `MlLinksPrewarmJob` |
| `packages/shared/src/api.ts` | modificar | `mlTag` em `marketplaceUpdateSchema` |
| `packages/marketplaces/src/scrapers/mercadolivre.ts` | modificar | extrair `endOfDaySaoPaulo` |
| `packages/marketplaces/src/mercadolivre/listing.ts` | criar | URL das listagens, parser de cards, `fetchMlListing` |
| `packages/marketplaces/src/mercadolivre/official-link.ts` | reescrever | `tag`, `generateOfficialMlLinks` em lote |
| `packages/marketplaces/src/mercadolivre/links-prewarm.ts` | criar | chaves do Redis, tipos e `prewarmMlAffiliateLinks` |
| `packages/marketplaces/src/tag-adapter.ts` | modificar | repassa a etiqueta ao gerador |
| `packages/marketplaces/src/index.ts` | modificar | exporta os módulos novos |
| `apps/api/src/lib/ml-api.ts` | modificar | `loadMlSessionCookies` |
| `apps/api/src/lib/ml-listing.ts` | criar | indireção testável + mapeamento de erros da listagem |
| `apps/api/src/lib/ml-links.ts` | criar | enfileira pré-aquecimento e lê o último erro do lote |
| `apps/api/src/routes/products.ts` | modificar | ramo `listing` em `/products/search` |
| `apps/api/src/routes/queue.ts`, `routes/batches.ts` | modificar | enfileiram o pré-aquecimento |
| `apps/api/src/routes/marketplaces.ts`, `lib/marketplaces.ts` | modificar | `mlTag`, `mlAffiliateTag`, `mlLinkBatchError` |
| `apps/worker/src/lib/ml-links.ts` | criar | `withMlLinkCache` + `LinkStore` sobre Redis |
| `apps/worker/src/processors/ml-links-prewarm.ts` | criar | processor do job |
| `apps/worker/src/processors/send-offer.ts`, `send-telegram.ts` | modificar | usam o cache de link do ML |
| `apps/worker/src/main.ts` | modificar | registra o worker da fila nova |
| `apps/web/src/lib/types.ts` | modificar | campos novos de `MarketplaceConnection` |
| `apps/web/src/components/marketplaces/marketplace-config.ts`, `marketplace-drawer.tsx` | modificar | campo "Etiqueta de afiliado" |
| `apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx` | modificar | aviso do erro do lote no card do ML |
| `apps/web/src/components/products/search-filters.tsx` | modificar | formulário do modo `listing` |
| `apps/web/src/app/(app)/produtos/page.tsx` | modificar | subaba "Ofertas do ML" |

---

### Task 1: Contratos compartilhados (schema, categorias, fila, `mlTag`)

**Files:**
- Modify: `packages/shared/src/search.ts`
- Modify: `packages/shared/src/marketplaces.ts` (final do arquivo)
- Modify: `packages/shared/src/queues.ts`
- Modify: `packages/shared/src/api.ts:77-105`
- Test: `packages/shared/test/ml-listing.test.ts` (criar)

**Interfaces:**
- Produces: `SEARCH_MODES` com `'listing'`; `ML_LISTING_KINDS`, `type MlListingKind`, `type MlListingQuery = { kind: MlListingKind; categoryId?: string; url?: string }`; `SearchQuery.mlListing?: MlListingQuery`; `ML_DEAL_CATEGORIES: readonly { id: string; label: string }[]`; `QUEUE_ML_LINKS_PREWARM = 'ml-links-prewarm'`; `interface MlLinksPrewarmJob { tenantId: string; urls: string[] }`; `marketplaceUpdateSchema.mlTag?: string`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/test/ml-listing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../src/search';
import { marketplaceUpdateSchema } from '../src/api';
import { ML_DEAL_CATEGORIES } from '../src/marketplaces';
import { QUEUE_ML_LINKS_PREWARM } from '../src/queues';

const base = { source: 'MERCADOLIVRE', mode: 'listing' } as const;

describe('searchQuerySchema: listagem do Mercado Livre', () => {
  it('aceita ofertas do dia e relâmpago só com o tipo', () => {
    const deals = searchQuerySchema.parse({ ...base, mlListing: { kind: 'deals' } });
    expect(deals.mlListing).toEqual({ kind: 'deals' });
    const lightning = searchQuerySchema.parse({ ...base, mlListing: { kind: 'lightning' } });
    expect(lightning.mlListing?.kind).toBe('lightning');
  });

  it('exige categoryId MLB… quando o tipo é categoria', () => {
    expect(() => searchQuerySchema.parse({ ...base, mlListing: { kind: 'category' } })).toThrow();
    expect(() =>
      searchQuerySchema.parse({ ...base, mlListing: { kind: 'category', categoryId: 'abc' } }),
    ).toThrow();
    const ok = searchQuerySchema.parse({
      ...base,
      mlListing: { kind: 'category', categoryId: 'MLB1051' },
    });
    expect(ok.mlListing?.categoryId).toBe('MLB1051');
  });

  it('exige url quando o tipo é url', () => {
    expect(() => searchQuerySchema.parse({ ...base, mlListing: { kind: 'url' } })).toThrow();
    const ok = searchQuerySchema.parse({
      ...base,
      mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/ofertas' },
    });
    expect(ok.mlListing?.url).toBe('https://www.mercadolivre.com.br/ofertas');
  });

  it('exige mlListing no modo listing', () => {
    expect(() => searchQuerySchema.parse(base)).toThrow();
  });

  it('rejeita o modo listing fora do Mercado Livre', () => {
    expect(() =>
      searchQuerySchema.parse({
        source: 'SHOPEE',
        mode: 'listing',
        mlListing: { kind: 'deals' },
      }),
    ).toThrow();
  });
});

describe('marketplaceUpdateSchema: mlTag', () => {
  it('apara espaços e aceita vazio (limpar a etiqueta)', () => {
    expect(marketplaceUpdateSchema.parse({ mlTag: '  minha-tag ' }).mlTag).toBe('minha-tag');
    expect(marketplaceUpdateSchema.parse({ mlTag: '' }).mlTag).toBe('');
  });

  it('limita o tamanho', () => {
    expect(() => marketplaceUpdateSchema.parse({ mlTag: 'x'.repeat(101) })).toThrow();
  });
});

describe('ML_DEAL_CATEGORIES', () => {
  it('tem ids MLB… únicos e rótulos preenchidos', () => {
    expect(ML_DEAL_CATEGORIES.length).toBeGreaterThan(5);
    const ids = ML_DEAL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ML_DEAL_CATEGORIES) {
      expect(c.id).toMatch(/^MLB\d+$/);
      expect(c.label.length).toBeGreaterThan(2);
    }
  });
});

describe('fila de pré-aquecimento', () => {
  it('expõe o nome da fila', () => {
    expect(QUEUE_ML_LINKS_PREWARM).toBe('ml-links-prewarm');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/shared exec vitest run test/ml-listing.test.ts`
Expected: FAIL (import de `ML_DEAL_CATEGORIES` / `QUEUE_ML_LINKS_PREWARM` inexistentes; erros de tipo/validação).

- [ ] **Step 3: Implementar `search.ts`**

Em `packages/shared/src/search.ts`, trocar a linha de `SEARCH_MODES` e adicionar o schema da listagem; depois incluir o campo e a regra no `superRefine`:

```ts
export const SEARCH_MODES = ['keyword', 'category', 'trending', 'shop', 'listing'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Fontes da busca por listagem do Mercado Livre (ofertas do dia, categoria, relâmpago, URL colada). */
export const ML_LISTING_KINDS = ['deals', 'category', 'lightning', 'url'] as const;
export type MlListingKind = (typeof ML_LISTING_KINDS)[number];

const mlListingSchema = z.object({
  kind: z.enum(ML_LISTING_KINDS),
  categoryId: z.string().regex(/^MLB\d+$/, 'Categoria inválida').optional(),
  url: z.string().url().max(2000).optional(),
});
export type MlListingQuery = z.infer<typeof mlListingSchema>;
```

No `z.object({...})` de `searchQuerySchema`, logo após `freeShippingOnly: z.boolean().default(false),` adicionar:

```ts
    mlListing: mlListingSchema.optional(),
```

No `.superRefine`, antes do bloco `if (q.minPrice !== undefined && ...)`, adicionar:

```ts
    if (q.mode === 'listing') {
      if (q.source !== 'MERCADOLIVRE') {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'A busca por listagem só existe para o Mercado Livre',
        });
      }
      if (!q.mlListing) {
        ctx.addIssue({ code: 'custom', path: ['mlListing'], message: 'mlListing obrigatório' });
      } else {
        if (q.mlListing.kind === 'category' && !q.mlListing.categoryId)
          ctx.addIssue({
            code: 'custom',
            path: ['mlListing', 'categoryId'],
            message: 'categoryId obrigatório',
          });
        if (q.mlListing.kind === 'url' && !q.mlListing.url)
          ctx.addIssue({ code: 'custom', path: ['mlListing', 'url'], message: 'url obrigatória' });
      }
    }
```

- [ ] **Step 4: Implementar fila e `mlTag`**

`packages/shared/src/queues.ts` — após `QUEUE_GROUP_LINK_ROTATE`:

```ts
export const QUEUE_ML_LINKS_PREWARM = 'ml-links-prewarm';
```

e ao final do arquivo:

```ts
export interface MlLinksPrewarmJob {
  tenantId: string;
  /** `originalUrl` dos produtos do Mercado Livre cujo link meli.la deve ser gerado antes do envio. */
  urls: string[];
}
```

`packages/shared/src/api.ts` — em `marketplaceUpdateSchema`, depois de `mattTool`:

```ts
  /** Etiqueta de afiliado do ML usada no gerador de links meli.la; vazio = etiqueta padrão da conta. */
  mlTag: z.string().trim().max(100).optional(),
```

- [ ] **Step 5: Categorias**

Ao final de `packages/shared/src/marketplaces.ts`:

```ts
/**
 * Categorias raiz do Mercado Livre aceitas em `/ofertas?category=<id>`. A API pública de categorias
 * responde 403 para este app, então a lista é estática; cada id foi conferido abrindo a página.
 */
export const ML_DEAL_CATEGORIES = [
  { id: 'MLB1051', label: 'Celulares e Telefones' },
  { id: 'MLB1648', label: 'Informática' },
  { id: 'MLB1000', label: 'Eletrônicos, Áudio e Vídeo' },
  { id: 'MLB1144', label: 'Games' },
  { id: 'MLB5726', label: 'Eletrodomésticos' },
  { id: 'MLB1574', label: 'Casa, Móveis e Decoração' },
  { id: 'MLB1246', label: 'Beleza e Cuidado Pessoal' },
  { id: 'MLB1430', label: 'Calçados, Roupas e Bolsas' },
  { id: 'MLB3937', label: 'Joias e Relógios' },
  { id: 'MLB1276', label: 'Esportes e Fitness' },
  { id: 'MLB1132', label: 'Brinquedos e Hobbies' },
  { id: 'MLB1384', label: 'Bebês' },
  { id: 'MLB1500', label: 'Construção' },
  { id: 'MLB263532', label: 'Ferramentas' },
  { id: 'MLB5672', label: 'Acessórios para Veículos' },
  { id: 'MLB1403', label: 'Alimentos e Bebidas' },
  { id: 'MLB1071', label: 'Animais' },
  { id: 'MLB1039', label: 'Câmeras e Acessórios' },
  { id: 'MLB1182', label: 'Instrumentos Musicais' },
  { id: 'MLB1196', label: 'Livros, Revistas e Comics' },
] as const;
```

- [ ] **Step 6: Conferir cada categoria na página real e podar a lista**

Rodar este script (de qualquer pasta; Node 22+) e **remover de `ML_DEAL_CATEGORIES` todo id que não aparecer como `OK`**. `IGNORADO` = o ML ignorou o filtro (id inexistente); `SEM CARDS` = página vazia.

```bash
node --input-type=module -e "
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const get=async(u)=>(await fetch(u,{headers:{'user-agent':UA,'accept-language':'pt-BR,pt;q=0.9'}})).text();
const firsts=(h)=>[...h.matchAll(/<a href=\"([^\"]+)\"[^>]*class=\"poly-component__title\"/g)].slice(0,5).map((m)=>m[1].split('?')[0]).join('|');
const ids=['MLB1051','MLB1648','MLB1000','MLB1144','MLB5726','MLB1574','MLB1246','MLB1430','MLB3937','MLB1276','MLB1132','MLB1384','MLB1500','MLB263532','MLB5672','MLB1403','MLB1071','MLB1039','MLB1182','MLB1196'];
const base=firsts(await get('https://www.mercadolivre.com.br/ofertas'));
for(const id of ids){const f=firsts(await get('https://www.mercadolivre.com.br/ofertas?category='+id));console.log(id,!f?'SEM CARDS':f===base?'IGNORADO':'OK');await new Promise(r=>setTimeout(r,1500));}
"
```

Expected: a linha de cada id com `OK`/`IGNORADO`/`SEM CARDS`. Se todos forem `OK`, nada a remover; se o ML estiver bloqueando (todos `SEM CARDS`), aguarde alguns minutos e repita antes de decidir.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/shared exec vitest run`
Expected: PASS (inclusive `search.test.ts` e `api.test.ts` existentes).

Run: `pnpm --filter @afilados/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/shared/src packages/shared/test/ml-listing.test.ts
git add packages/shared
git commit -m "feat(shared): modo listing, categorias do ML, fila de pré-aquecimento e mlTag

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parser das listagens do ML (`listing.ts`, parte pura)

**Files:**
- Modify: `packages/marketplaces/src/scrapers/mercadolivre.ts:215-225` (extrair `endOfDaySaoPaulo`)
- Create: `packages/marketplaces/src/mercadolivre/listing.ts`
- Create: `packages/marketplaces/test/helpers/ml-listing-html.ts`
- Create: `packages/marketplaces/test/fixtures/ml-listing-ofertas.html` (gerado do ML real)
- Modify: `packages/marketplaces/src/index.ts`
- Test: `packages/marketplaces/test/ml-listing.test.ts` (criar)

**Interfaces:**
- Consumes: `parseProductUrl` de `@afilados/core`; `parseMoney` de `../scrapers/fetcher`.
- Produces (usados pelas Tasks 3 e 6):
  - `endOfDaySaoPaulo(now?: Date): string` (ISO) em `scrapers/mercadolivre.ts` (já sai de `@afilados/marketplaces` via `export * from './scrapers'`)
  - `type MlListingSource = { kind: 'deals' } | { kind: 'category'; categoryId: string } | { kind: 'lightning' } | { kind: 'url'; url: string }`
  - `type MlListingErrorCode = 'ML_LISTING_BLOCKED' | 'ML_LISTING_LAYOUT' | 'ML_LISTING_INVALID_URL' | 'ML_LISTING_HTTP'`
  - `class MlListingError extends Error { code: MlListingErrorCode; details?: string }`
  - `buildMlListingUrl(source: MlListingSource, page: number): string`
  - `cleanMlProductUrl(href: string): string | undefined`
  - `isMlVerificationPage(finalUrl: string, html: string): boolean`
  - `parseMlListingHtml(html: string, now?: Date): ProductData[]`

- [ ] **Step 1: Extrair `endOfDaySaoPaulo` (refactor sem mudar comportamento)**

Em `packages/marketplaces/src/scrapers/mercadolivre.ts`, substituir o bloco `// c) Só o selo: ...` até o `return new Date(endOfDayUtc).toISOString();` (fim de `detectFlashSaleEnd`) por:

```ts
  // c) Só o selo: assume fim do dia em São Paulo (UTC-3)
  return endOfDaySaoPaulo(now);
}

/** Fim do dia (23:59:59) em São Paulo (UTC-3, sem horário de verão) como ISO UTC. */
export function endOfDaySaoPaulo(now: Date = new Date()): string {
  const spNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const endOfDayUtc = Date.UTC(
    spNow.getUTCFullYear(),
    spNow.getUTCMonth(),
    spNow.getUTCDate(),
    23 + 3,
    59,
    59,
  );
  return new Date(endOfDayUtc).toISOString();
}
```

(Remova o `}` de fechamento antigo de `detectFlashSaleEnd` que ficar sobrando logo depois; `scrapeMercadoLivre` logo abaixo continua igual.)

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-official-link.test.ts`
Expected: PASS (os testes de "Oferta Relâmpago" continuam verdes).

- [ ] **Step 2: Criar o helper de HTML dos testes**

Criar `packages/marketplaces/test/helpers/ml-listing-html.ts`:

```ts
export function money(frac: string, cents?: string): string {
  return (
    '<span class="andes-money-amount poly-price__amount">' +
    '<span class="andes-money-amount__currency"><span class="andes-money-amount__currency-symbol">R$</span></span>' +
    `<span class="andes-money-amount__fraction">${frac}</span>` +
    (cents ? `<span class="andes-money-amount__cents">${cents}</span>` : '') +
    '</span>'
  );
}

export interface CardOpts {
  title?: string;
  href?: string;
  image?: string;
  prev?: string;
  cur?: [string, string?];
  discount?: string;
  note?: string;
  shipping?: string;
  full?: boolean;
  countdown?: boolean;
}

export const CATALOG_HREF =
  'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402?pdp_filters=deal%3AMLB779362-1#polycard_client=offers&amp;position=1&amp;wid=MLB4083441037&amp;sid=offers';

/** Card `poly-card` com o mesmo desenho do HTML real das listagens (subconjunto relevante). */
export function polyCard(o: CardOpts = {}): string {
  const title = o.title ?? 'Smartwatch Huawei Band 10';
  const image =
    o.image ?? 'https://http2.mlstatic.com/D_Q_NP_2X_772291-MLA100008466405_122025-AB.webp';
  const cur = o.cur ?? ['183', '08'];
  return (
    '<div class="andes-card poly-card poly-card--grid-card">' +
    '<div class="poly-card__portada">' +
    (image ? `<img class="poly-component__picture" src="${image}" alt="">` : '') +
    (o.countdown
      ? '<div class="poly-component__highlight-countdown poly-component__widget"><span class="poly-highlight-countdown__text"></span></div>'
      : '') +
    '</div><div class="poly-card__content">' +
    '<h3 class="poly-component__title-wrapper">' +
    `<a href="${o.href ?? CATALOG_HREF}" target="_self" class="poly-component__title">${title}</a></h3>` +
    '<div class="poly-component__price">' +
    (o.prev
      ? `<div class="poly-price__labels"><span class="poly-price__label"><s class="andes-money-amount polylabel-price andes-money-amount--previous"><span class="andes-money-amount__fraction">${o.prev}</span></s></span></div>`
      : '') +
    `<div class="poly-price__current">${money(cur[0], cur[1])}` +
    (o.discount
      ? `<span class="poly-price__discount-polylabel"><span class="polylabel-pill">${o.discount}</span></span>`
      : '') +
    '</div>' +
    (o.note ? `<span class="poly-price__unit-description">${o.note}</span>` : '') +
    '<span class="poly-price__installments">ou <span class="andes-money-amount"><span class="andes-money-amount__fraction">199</span></span> em outros meios</span>' +
    '</div>' +
    '<div class="poly-component__shipping-v2"><div class="poly-shipping-v2__item"><span>' +
    (o.shipping ?? '') +
    (o.full
      ? '<svg aria-label="Enviado pelo FULL" role="img" class="polylabel-icon"><use href="#poly_full"></use></svg>'
      : '') +
    '</span></div></div></div></div>'
  );
}

/** Página mínima: cards + o JSON embutido onde o ML guarda o `period_end` de cada contagem. */
export function listingPage(cards: string[], periodEnds: string[] = []): string {
  const ctx = periodEnds
    .map((e) => `{"countdown":{"animation":true,"period_end":"${e}"}}`)
    .join(',');
  return (
    '<!doctype html><html><body><div class="items-with-smart-groups">' +
    cards.join('\n') +
    `</div><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"items":[${ctx}]}</script></body></html>`
  );
}
```

- [ ] **Step 3: Escrever os testes que falham**

Criar `packages/marketplaces/test/ml-listing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMlListingUrl,
  cleanMlProductUrl,
  endOfDaySaoPaulo,
  isMlVerificationPage,
  parseMlListingHtml,
} from '../src';
import { CATALOG_HREF, listingPage, polyCard } from './helpers/ml-listing-html';

const NOW = new Date('2026-10-05T15:00:00.000Z');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('endOfDaySaoPaulo', () => {
  it('devolve 23:59:59 em São Paulo como ISO UTC', () => {
    expect(endOfDaySaoPaulo(NOW)).toBe('2026-10-06T02:59:59.000Z');
    expect(endOfDaySaoPaulo(new Date('2026-10-06T01:00:00.000Z'))).toBe('2026-10-06T02:59:59.000Z');
  });
});

describe('buildMlListingUrl', () => {
  it('monta as quatro fontes e a paginação', () => {
    expect(buildMlListingUrl({ kind: 'deals' }, 1)).toBe('https://www.mercadolivre.com.br/ofertas');
    expect(buildMlListingUrl({ kind: 'deals' }, 2)).toBe(
      'https://www.mercadolivre.com.br/ofertas?page=2',
    );
    expect(buildMlListingUrl({ kind: 'lightning' }, 1)).toBe(
      'https://www.mercadolivre.com.br/ofertas?promotion_type=lightning',
    );
    expect(buildMlListingUrl({ kind: 'category', categoryId: 'MLB1051' }, 3)).toBe(
      'https://www.mercadolivre.com.br/ofertas?category=MLB1051&page=3',
    );
    expect(
      buildMlListingUrl(
        { kind: 'url', url: 'https://www.mercadolivre.com.br/mais-vendidos#frag' },
        2,
      ),
    ).toBe('https://www.mercadolivre.com.br/mais-vendidos?page=2');
  });

  it('rejeita categoria inválida e URL fora do domínio do ML', () => {
    const invalid = (fn: () => unknown) =>
      expect(thrown(fn)).toMatchObject({ code: 'ML_LISTING_INVALID_URL' });
    invalid(() => buildMlListingUrl({ kind: 'category', categoryId: 'abc' }, 1));
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'http://www.mercadolivre.com.br/x' }, 1));
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'https://evil.com/ofertas' }, 1));
    invalid(() =>
      buildMlListingUrl({ kind: 'url', url: 'https://mercadolivre.com.br.evil.com/x' }, 1),
    );
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'não é url' }, 1));
    expect(
      buildMlListingUrl({ kind: 'url', url: 'https://lista.mercadolivre.com.br/fone' }, 1),
    ).toBe('https://lista.mercadolivre.com.br/fone');
  });
});

describe('cleanMlProductUrl', () => {
  it('tira query e fragmento; preserva o wid em link de catálogo', () => {
    expect(cleanMlProductUrl(CATALOG_HREF.replace(/&amp;/g, '&'))).toBe(
      'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402#wid=MLB4083441037',
    );
    expect(
      cleanMlProductUrl(
        'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-_JM?searchVariation=1#polycard_client=offers&wid=MLB1',
      ),
    ).toBe('https://produto.mercadolivre.com.br/MLB-5421116792-tenis-_JM');
  });

  it('descarta patrocinado (click1), domínio de terceiros e lixo', () => {
    expect(cleanMlProductUrl('https://click1.mercadolivre.com.br/mclics/x?a=1')).toBeUndefined();
    expect(cleanMlProductUrl('https://evil.com/p/MLB1')).toBeUndefined();
    expect(cleanMlProductUrl('')).toBeUndefined();
  });
});

describe('isMlVerificationPage', () => {
  it('detecta pela URL final ou pelo HTML sem cards', () => {
    expect(
      isMlVerificationPage('https://www.mercadolivre.com.br/gz/account-verification?go=x', ''),
    ).toBe(true);
    expect(
      isMlVerificationPage(
        'https://www.mercadolivre.com.br/ofertas',
        '<link href=".../suspicious-traffic-frontend/gz-account-verification-index.css">',
      ),
    ).toBe(true);
    expect(isMlVerificationPage('https://www.mercadolivre.com.br/ofertas', polyCard())).toBe(false);
    expect(isMlVerificationPage('https://www.mercadolivre.com.br/ofertas', '<html></html>')).toBe(
      false,
    );
  });
});

describe('parseMlListingHtml: poly-card', () => {
  it('lê um card de catálogo com preço riscado, Pix, Full e wid', () => {
    const html = listingPage([
      polyCard({
        prev: '659',
        cur: ['183', '08'],
        discount: '72% OFF',
        note: 'no Pix',
        shipping: 'Chegará grátis amanhã',
        full: true,
      }),
    ]);
    expect(parseMlListingHtml(html, NOW)).toEqual([
      {
        source: 'MERCADOLIVRE',
        externalId: 'MLB46202402',
        title: 'Smartwatch Huawei Band 10',
        price: 183.08,
        originalPrice: 659,
        discountPct: 72,
        images: ['https://http2.mlstatic.com/D_Q_NP_2X_772291-MLA100008466405_122025-AB.webp'],
        shipping: 'FULL',
        originalUrl:
          'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402#wid=MLB4083441037',
        raw: { origin: 'ml-listing', priceNote: 'no Pix' },
      },
    ]);
  });

  it('lê anúncio individual sem preço riscado e com frete grátis', () => {
    const html = listingPage([
      polyCard({
        title: 'Tênis Sapatênis Masculino',
        href: 'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-sapatenis-_JM?searchVariation=188287640099#polycard_client=offers&amp;position=2',
        cur: ['1.299', '90'],
        shipping: 'Frete grátis',
      }),
    ]);
    const [p] = parseMlListingHtml(html, NOW);
    expect(p).toMatchObject({
      externalId: 'MLB5421116792',
      title: 'Tênis Sapatênis Masculino',
      price: 1299.9,
      shipping: 'FREE',
      originalUrl: 'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-sapatenis-_JM',
    });
    expect(p?.originalPrice).toBeUndefined();
    expect(p?.discountPct).toBeUndefined();
  });

  it('calcula o desconto quando o rótulo não existe e ignora riscado <= atual', () => {
    const html = listingPage([
      polyCard({ prev: '200', cur: ['150'] }),
      polyCard({
        title: 'Outro',
        href: 'https://www.mercadolivre.com.br/outro/p/MLB900',
        prev: '100',
        cur: ['150'],
      }),
    ]);
    const [a, b] = parseMlListingHtml(html, NOW);
    expect(a).toMatchObject({ price: 150, originalPrice: 200, discountPct: 25 });
    expect(b?.originalPrice).toBeUndefined();
  });

  it('descarta patrocinado, sem imagem, sem preço e sem título; deduplica', () => {
    const sponsored = polyCard({
      title: 'Patrocinado',
      href: 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=x',
    });
    const noImage = polyCard({
      title: 'Sem imagem',
      image: '',
      href: 'https://www.mercadolivre.com.br/a/p/MLB1',
    });
    const noTitle = polyCard({ title: '', href: 'https://www.mercadolivre.com.br/b/p/MLB2' });
    const ok = polyCard({ prev: '300', cur: ['199'] });
    const html = listingPage([sponsored, noImage, noTitle, ok, ok]);
    const products = parseMlListingHtml(html, NOW);
    expect(products).toHaveLength(1);
    expect(products[0]?.externalId).toBe('MLB46202402');
  });

  it('associa o period_end de cada card com contagem, na ordem', () => {
    const html = listingPage(
      [
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/a/p/MLB11' }),
        polyCard({ href: 'https://www.mercadolivre.com.br/b/p/MLB22' }),
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/c/p/MLB33' }),
      ],
      ['2026-10-05T15:00:00Z', '2026-10-05T14:59:59Z'],
    );
    const [a, b, c] = parseMlListingHtml(html, NOW);
    expect(a?.flashSaleEndsAt).toBe('2026-10-05T15:00:00.000Z');
    expect(b?.flashSaleEndsAt).toBeUndefined();
    expect(c?.flashSaleEndsAt).toBe('2026-10-05T14:59:59.000Z');
  });

  it('usa o fim do dia em São Paulo quando as contagens não batem com o JSON', () => {
    const html = listingPage(
      [
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/a/p/MLB11' }),
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/c/p/MLB33' }),
      ],
      ['2026-10-05T15:00:00Z'],
    );
    const products = parseMlListingHtml(html, NOW);
    expect(products.map((p) => p.flashSaleEndsAt)).toEqual([
      '2026-10-06T02:59:59.000Z',
      '2026-10-06T02:59:59.000Z',
    ]);
  });
});

describe('parseMlListingHtml: carrossel', () => {
  it('lê o layout dynamic-carousel', () => {
    const html =
      '<html><body><div class="dynamic-carousel__item-container">' +
      '<a class="splinter-link" href="https://www.mercadolivre.com.br/p/MLB777">' +
      '<img src="https://http2.mlstatic.com/D_1.webp">' +
      '<h3 class="dynamic-carousel__title">Fone Bluetooth</h3>' +
      '<span class="dynamic-carousel__oldprice">R$ 1.299</span>' +
      '<span class="dynamic-carousel__price"><span>899</span><sup class="dynamic-carousel__price-decimals">90</sup></span>' +
      '<sup class="dynamic-carousel__discount">30% OFF</sup>' +
      '</a></div></body></html>';
    expect(parseMlListingHtml(html, NOW)).toEqual([
      {
        source: 'MERCADOLIVRE',
        externalId: 'MLB777',
        title: 'Fone Bluetooth',
        price: 899.9,
        originalPrice: 1299,
        discountPct: 30,
        images: ['https://http2.mlstatic.com/D_1.webp'],
        shipping: 'UNKNOWN',
        originalUrl: 'https://www.mercadolivre.com.br/p/MLB777',
        raw: { origin: 'ml-listing' },
      },
    ]);
  });
});

describe('parseMlListingHtml: fixture real', () => {
  it('lê cards reais de /ofertas com os invariantes esperados', () => {
    const html = readFileSync(
      new URL('./fixtures/ml-listing-ofertas.html', import.meta.url),
      'utf8',
    );
    const cardCount = (html.match(/class="andes-card poly-card /g) ?? []).length;
    const countdownCount = (html.match(/class="poly-component__highlight-countdown /g) ?? [])
      .length;
    const products = parseMlListingHtml(html, NOW);

    expect(cardCount).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThanOrEqual(Math.floor(cardCount * 0.8));
    for (const p of products) {
      expect(p.source).toBe('MERCADOLIVRE');
      expect(p.externalId).toMatch(/^MLB\d+$/);
      expect(p.price).toBeGreaterThan(0);
      expect(p.images[0]).toMatch(/^https:\/\//);
      expect(p.originalUrl).toMatch(/^https:\/\/[^?#]+(#wid=MLB\d+)?$/);
      if (p.originalPrice !== undefined) expect(p.originalPrice).toBeGreaterThan(p.price);
      if (p.discountPct !== undefined) {
        expect(p.discountPct).toBeGreaterThan(0);
        expect(p.discountPct).toBeLessThan(100);
      }
    }
    const flash = products.filter((p) => p.flashSaleEndsAt);
    expect(flash.length).toBeLessThanOrEqual(countdownCount);
    for (const p of flash) expect(Number.isNaN(Date.parse(p.flashSaleEndsAt!))).toBe(false);
  });

  it('o parser não acha cards na página de verificação', () => {
    expect(parseMlListingHtml('<html><body>suspicious-traffic</body></html>', NOW)).toEqual([]);
  });
});
```

- [ ] **Step 4: Gerar a fixture real**

Criar o script temporário `packages/marketplaces/_gen-fixture.tmp.mjs` (roda dentro do pacote para resolver `cheerio`), executar e apagar:

```js
import * as cheerio from 'cheerio';
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const res = await fetch('https://www.mercadolivre.com.br/ofertas?promotion_type=lightning', {
  headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' },
});
const html = await res.text();
const $ = cheerio.load(html);
const isCountdown = (el) => $(el).find('.poly-component__highlight-countdown').length > 0;
const cards = $('.poly-card').toArray();
const withCd = cards.filter(isCountdown).slice(0, 3);
const without = cards.filter((el) => !isCountdown(el)).slice(0, 5);
if (without.length < 3) throw new Error('página bloqueada ou sem cards; tente de novo mais tarde');
const ends = [...html.matchAll(/"period_end"\s*:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .slice(0, withCd.length);
const ctx = ends.map((e) => `{"countdown":{"animation":true,"period_end":"${e}"}}`).join(',');
fs.mkdirSync('test/fixtures', { recursive: true });
fs.writeFileSync(
  'test/fixtures/ml-listing-ofertas.html',
  `<!doctype html><html><body><div class="items-with-smart-groups">\n${[...without, ...withCd]
    .map((el) => $.html(el))
    .join('\n')}\n</div><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"items":[${ctx}]}</script></body></html>`,
);
console.log('cards:', without.length + withCd.length, 'com contagem:', withCd.length);
```

Run (na pasta `packages/marketplaces`):

```bash
cd packages/marketplaces && node _gen-fixture.tmp.mjs && rm -f _gen-fixture.tmp.mjs && cd ../..
```

Expected: `cards: 8 com contagem: 3` (ou menos contagens se não houver relâmpago agora) e o arquivo `packages/marketplaces/test/fixtures/ml-listing-ofertas.html` criado.

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-listing.test.ts`
Expected: FAIL (`parseMlListingHtml`/`buildMlListingUrl`… não exportados).

- [ ] **Step 6: Implementar `listing.ts` (parte pura)**

Criar `packages/marketplaces/src/mercadolivre/listing.ts`:

```ts
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
  | 'ML_LISTING_BLOCKED'
  | 'ML_LISTING_LAYOUT'
  | 'ML_LISTING_INVALID_URL'
  | 'ML_LISTING_HTTP';

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
  let u: URL;
  try {
    u = new URL(href, ML_ORIGIN);
  } catch {
    return undefined;
  }
  if (/^click\d*\./i.test(u.hostname) || !isMlHost(u.hostname)) return undefined;
  const base = `${u.origin}${u.pathname}`;
  const wid =
    new URLSearchParams(u.hash.replace(/^#/, '')).get('wid') ?? u.searchParams.get('wid');
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
```

Em `packages/marketplaces/src/index.ts`, após `export * from './mercadolivre/official-link';` adicionar:

```ts
export * from './mercadolivre/listing';
```

(`endOfDaySaoPaulo` já é exportado por `export * from './scrapers'`, que reexporta `./mercadolivre` do diretório de scrapers; não adicione outra linha para ele.)

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-listing.test.ts`
Expected: PASS em todos os testes (inclusive a fixture real).

Run: `pnpm --filter @afilados/marketplaces exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/marketplaces/src packages/marketplaces/test/ml-listing.test.ts packages/marketplaces/test/helpers
git add packages/marketplaces
git commit -m "feat(marketplaces): parser das listagens de ofertas do Mercado Livre

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `fetchMlListing` (paginação, cookies de fallback, erros)

**Files:**
- Modify: `packages/marketplaces/src/mercadolivre/listing.ts` (acrescentar ao final)
- Test: `packages/marketplaces/test/ml-listing-fetch.test.ts` (criar)

**Interfaces:**
- Consumes: `buildMlListingUrl`, `parseMlListingHtml`, `isMlVerificationPage`, `MlListingError` (Task 2); `cookieHeader` de `./official-link`.
- Produces: `ML_LISTING_MAX_PAGES = 5`; `interface FetchMlListingOptions { limit: number; cookies?; filter?; maxPages?; fetchImpl?; sleep?; now? }`; `fetchMlListing(source: MlListingSource, opts: FetchMlListingOptions): Promise<ProductData[]>`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `packages/marketplaces/test/ml-listing-fetch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchMlListing, MlListingError } from '../src';
import { listingPage, polyCard } from './helpers/ml-listing-html';

function cards(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return polyCard({
      title: `Produto ${id}`,
      href: `https://www.mercadolivre.com.br/produto-${id}/p/MLB${1000 + id}`,
      prev: '300',
      cur: ['150'],
      discount: '50% OFF',
    });
  });
}

function resp(html: string, o: { status?: number; url?: string } = {}) {
  return {
    ok: (o.status ?? 200) < 400,
    status: o.status ?? 200,
    url: o.url ?? 'https://www.mercadolivre.com.br/ofertas',
    text: async () => html,
  } as unknown as Response;
}

const blocked = () =>
  resp('<html>suspicious-traffic</html>', {
    url: 'https://www.mercadolivre.com.br/gz/account-verification?go=x',
  });

const noSleep = async () => {};

describe('fetchMlListing', () => {
  it('pagina até juntar o limite e pausa entre páginas', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3, 1))))
      .mockResolvedValueOnce(resp(listingPage(cards(3, 4))));
    const sleep = vi.fn(async () => {});
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 5, fetchImpl: fetchImpl as unknown as typeof fetch, sleep },
    );
    expect(out).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://www.mercadolivre.com.br/ofertas?page=2');
    expect(sleep).toHaveBeenCalledTimes(1);
    const ms = (sleep.mock.calls[0] as unknown as [number])[0];
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(2000);
  });

  it('para no teto de 5 páginas mesmo com limite maior', async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => resp(listingPage(cards(2, 1 + page++ * 2))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 500, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(out).toHaveLength(10);
  });

  it('aplica o filtro durante a paginação e segue buscando até juntar o limite', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3, 1))))
      .mockResolvedValueOnce(resp(listingPage(cards(3, 4))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      {
        limit: 2,
        // só os ids pares passam
        filter: (p) => Number(p.title.replace('Produto ', '')) % 2 === 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      },
    );
    expect(out.map((p) => p.title)).toEqual(['Produto 2', 'Produto 4']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('para quando a página repete o que já veio', async () => {
    const same = resp(listingPage(cards(3, 1)));
    const fetchImpl = vi.fn(async () => same);
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 100, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(out).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('repete a página com os cookies da sessão quando cai na verificação', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(blocked())
      .mockResolvedValueOnce(resp(listingPage(cards(2))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      {
        limit: 10,
        cookies: { ssid: 'abc', orguseridp: '1' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      },
    );
    expect(out).toHaveLength(2);
    const first = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const second = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect((first.headers as Record<string, string>).Cookie).toBeUndefined();
    expect((second.headers as Record<string, string>).Cookie).toBe('ssid=abc; orguseridp=1');
  });

  it('ML_LISTING_BLOCKED sem cookies e com cookies que não adiantam', async () => {
    const run = (cookies?: Record<string, string>) =>
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          ...(cookies ? { cookies } : {}),
          fetchImpl: vi.fn(async () => blocked()) as unknown as typeof fetch,
          sleep: noSleep,
        },
      );
    await expect(run()).rejects.toMatchObject({ code: 'ML_LISTING_BLOCKED' });
    const err = await run({ a: '1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlListingError);
    expect((err as MlListingError).message).toMatch(/sess/i);
  });

  it('trata 403 e 429 como bloqueio', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => resp('', { status: 429 })) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_BLOCKED' });
  });

  it('ML_LISTING_LAYOUT quando a página 1 vem sem nenhum card reconhecido', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () =>
            resp('<html><body><div class="novo-layout">…</div></body></html>'),
          ) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_LAYOUT' });
  });

  it('ML_LISTING_HTTP em erro HTTP na página 1', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => resp('', { status: 500 })) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_HTTP' });
  });

  it('falha na página 2 devolve o que veio na página 1', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3))))
      .mockResolvedValueOnce(resp('', { status: 500 }));
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 100, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(out).toHaveLength(3);
  });

  it('URL inválida falha antes de qualquer requisição', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchMlListing(
        { kind: 'url', url: 'https://evil.com/x' },
        { limit: 10, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_INVALID_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-listing-fetch.test.ts`
Expected: FAIL (`fetchMlListing` não exportado).

- [ ] **Step 3: Implementar**

Em `packages/marketplaces/src/mercadolivre/listing.ts`, adicionar ao topo, junto dos outros imports:

```ts
import { cookieHeader } from './official-link';
```

e ao final do arquivo:

```ts
export const ML_LISTING_MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 15_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

export interface FetchMlListingOptions {
  /** Quantos produtos (que passem em `filter`) juntar antes de parar. */
  limit: number;
  /** Cookies da sessão sincronizada; usados só quando a página anônima cai na verificação. */
  cookies?: Record<string, string> | undefined;
  /** Aplicado a cada produto durante a paginação (desconto, preço, frete…). */
  filter?: ((product: ProductData) => boolean) | undefined;
  maxPages?: number | undefined;
  /** Injetáveis em testes. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

interface LoadedPage {
  html: string;
  finalUrl: string;
  blockedStatus: boolean;
}

/**
 * Lê a listagem página a página (48 cards cada). Cada página é pedida primeiro sem cookies; se cair
 * na verificação anti-bot e houver sessão sincronizada, repete com ela. Na página 1 os erros sobem
 * (`MlListingError`); a partir da página 2 qualquer falha só encerra a paginação com o que já veio.
 */
export async function fetchMlListing(
  source: MlListingSource,
  opts: FetchMlListingOptions,
): Promise<ProductData[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const maxPages = opts.maxPages ?? ML_LISTING_MAX_PAGES;
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
      const finalUrl = res.url || url;
      if (res.status === 403 || res.status === 429) {
        return { html: '', finalUrl, blockedStatus: true };
      }
      if (!res.ok) {
        throw new MlListingError(
          `O Mercado Livre respondeu HTTP ${res.status}`,
          'ML_LISTING_HTTP',
          url,
        );
      }
      return { html: await res.text(), finalUrl, blockedStatus: false };
    } finally {
      clearTimeout(timer);
    }
  }
  const isBlocked = (p: LoadedPage) => p.blockedStatus || isMlVerificationPage(p.finalUrl, p.html);

  const out: ProductData[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages && out.length < opts.limit; page++) {
    const url = buildMlListingUrl(source, page); // lança ML_LISTING_INVALID_URL antes de qualquer requisição
    let loaded: LoadedPage;
    try {
      loaded = await load(url, false);
      if (isBlocked(loaded) && cookie) loaded = await load(url, true);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (isBlocked(loaded)) {
      if (page > 1) break;
      throw new MlListingError(
        cookie
          ? 'O Mercado Livre bloqueou a listagem mesmo com a sessão sincronizada; a sessão pode ter expirado'
          : 'O Mercado Livre bloqueou a listagem (verificação anti-bot) e não há sessão sincronizada',
        'ML_LISTING_BLOCKED',
        url,
      );
    }

    const products = parseMlListingHtml(loaded.html, now());
    if (products.length === 0) {
      if (page > 1) break;
      throw new MlListingError(
        'A página de ofertas do Mercado Livre mudou de layout e nenhum produto foi reconhecido',
        'ML_LISTING_LAYOUT',
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-listing-fetch.test.ts test/ml-listing.test.ts`
Expected: PASS.

Run: `pnpm --filter @afilados/marketplaces exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/marketplaces/src/mercadolivre/listing.ts packages/marketplaces/test/ml-listing-fetch.test.ts
git add packages/marketplaces
git commit -m "feat(marketplaces): fetchMlListing com paginação, filtro e cookies de fallback

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gerador de links em lote (`generateOfficialMlLinks`) + etiqueta

**Files:**
- Rewrite: `packages/marketplaces/src/mercadolivre/official-link.ts` (arquivo completo abaixo)
- Test: `packages/marketplaces/test/ml-official-link-batch.test.ts` (criar)

**Interfaces:**
- Consumes: —
- Produces:
  - `OfficialLinkOptions` ganha `tag?: string | undefined`
  - `ML_LINKBUILDER_BATCH_SIZE = 20`
  - `interface BatchLinkOptions extends OfficialLinkOptions { pauseMs?: number | undefined; sleep?: ((ms: number) => Promise<void>) | undefined }`
  - `interface BatchLinkResult { links: Map<string, string>; failures: { urls: string[]; message: string }[] }`
  - `generateOfficialMlLinks(urls: string[], cookies: Record<string, string>, opts?: BatchLinkOptions): Promise<BatchLinkResult>` — chave do mapa = a URL **enviada**; lança `MlSessionError('ML_SESSION_EXPIRED')` quando a sessão expirou.
  - `generateOfficialMlLink` (método 2) mantém a assinatura, agora enviando `opts.tag ?? ''`.
  - Inalterados: `ML_LINKBUILDER_PAGE`, `ML_LINKBUILDER_ENDPOINT_DEFAULT`, `MlSessionError`, `cookieHeader`, `extractCsrfToken`, `findMeliLink`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `packages/marketplaces/test/ml-official-link-batch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  generateOfficialMlLink,
  generateOfficialMlLinks,
  ML_LINKBUILDER_BATCH_SIZE,
  ML_LINKBUILDER_PAGE,
} from '../src';

function resp(body: unknown, init: { status?: number; url?: string } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? 'https://www.mercadolivre.com.br/x',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const urls = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://www.mercadolivre.com.br/p/MLB${100 + i}`);

/** fetch simulado: 1ª chamada = painel (CSRF); as demais = createLink, tratadas por `onPost`. */
function mockFetch(onPost: (sent: string[], index: number, init: RequestInit) => Response) {
  let post = 0;
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (input === ML_LINKBUILDER_PAGE) return resp('<meta name="csrf-token" content="tok-1">');
    const body = JSON.parse(String(init?.body)) as { urls: string[]; tag: string };
    return onPost(body.urls, post++, init!);
  });
}

const okLinks = (sent: string[]) =>
  resp({
    urls: sent.map((u, i) => ({ origin_url: u, short_url: `https://meli.la/${i}${u.slice(-3)}` })),
  });

const cookies = { ssid: 'abc' };
const noSleep = async () => {};

describe('generateOfficialMlLinks (método 1: lote)', () => {
  it('divide 45 URLs em lotes de 20, abre o painel uma vez e pausa entre lotes', async () => {
    expect(ML_LINKBUILDER_BATCH_SIZE).toBe(20);
    const fetchImpl = mockFetch((sent) => okLinks(sent));
    const sleep = vi.fn(async () => {});
    const input = urls(45);
    const r = await generateOfficialMlLinks(input, cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      pauseMs: 2500,
      tag: 'minha-tag',
    });
    expect(r.links.size).toBe(45);
    expect(r.failures).toEqual([]);
    // 1 painel + 3 createLink
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const sizes = fetchImpl.mock.calls
      .slice(1)
      .map((c) => JSON.parse(String(c[1]?.body)).urls.length);
    expect(sizes).toEqual([20, 20, 5]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).tag).toBe('minha-tag');
    const headers = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('tok-1');
    expect(headers.Cookie).toBe('ssid=abc');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2500);
  });

  it('casa a resposta com a URL enviada mesmo quando origin_url vem sem fragmento/query', async () => {
    const sent = 'https://www.mercadolivre.com.br/produto/p/MLB46202402#wid=MLB4083441037';
    const fetchImpl = mockFetch(() =>
      resp({
        urls: [
          {
            origin_url: 'https://www.mercadolivre.com.br/produto/p/MLB46202402',
            short_url: 'https://meli.la/1AbC',
          },
        ],
      }),
    );
    const r = await generateOfficialMlLinks([sent], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.get(sent)).toBe('https://meli.la/1AbC');
  });

  it('um lote com erro HTTP vira falha e os outros lotes seguem', async () => {
    const fetchImpl = mockFetch((sent, i) =>
      i === 0 ? resp('boom', { status: 500 }) : okLinks(sent),
    );
    const r = await generateOfficialMlLinks(urls(25), cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.size).toBe(5);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]?.urls).toHaveLength(20);
    expect(r.failures[0]?.message).toMatch(/HTTP 500/);
  });

  it('entrada sem short_url fica de fora sem virar falha do lote', async () => {
    const [a, b] = urls(2) as [string, string];
    const fetchImpl = mockFetch(() =>
      resp({ urls: [{ origin_url: a, short_url: 'https://meli.la/ok1' }, { origin_url: b }] }),
    );
    const r = await generateOfficialMlLinks([a, b], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect([...r.links.keys()]).toEqual([a]);
    expect(r.failures).toEqual([]);
  });

  it('resposta sem a lista urls[] vira falha do lote', async () => {
    const fetchImpl = mockFetch(() => resp({ erro: 'formato novo' }));
    const r = await generateOfficialMlLinks(urls(3), cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.size).toBe(0);
    expect(r.failures[0]?.message).toMatch(/lista de links/);
  });

  it('deduplica as URLs', async () => {
    const fetchImpl = mockFetch((sent) => okLinks(sent));
    const [a] = urls(1) as [string];
    const r = await generateOfficialMlLinks([a, a, a], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).urls).toEqual([a]);
    expect(r.links.size).toBe(1);
  });

  it('sessão expirada (painel redireciona para login) lança ML_SESSION_EXPIRED', async () => {
    const fetchImpl = vi.fn(async () =>
      resp('', { url: 'https://www.mercadolivre.com.br/login?x' }),
    );
    await expect(
      generateOfficialMlLinks(urls(2), cookies, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
  });

  it('403 no createLink lança ML_SESSION_EXPIRED', async () => {
    const fetchImpl = mockFetch(() => resp('', { status: 403 }));
    await expect(
      generateOfficialMlLinks(urls(2), cookies, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
  });

  it('sem cookies lança ML_SESSION_EXPIRED antes de qualquer requisição', async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateOfficialMlLinks(urls(1), {}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lista vazia não faz requisição', async () => {
    const fetchImpl = vi.fn();
    const r = await generateOfficialMlLinks([], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.links.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('generateOfficialMlLink (método 2) com etiqueta', () => {
  it('envia a etiqueta no corpo e mantém tag vazia por padrão', async () => {
    const fetchImpl = mockFetch(() => resp({ urls: [{ short_url: 'https://meli.la/abc123' }] }));
    const u = 'https://www.mercadolivre.com.br/p/MLB1';
    await generateOfficialMlLink(u, cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tag: 'etq',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      urls: [u],
      tag: 'etq',
    });

    const fetch2 = mockFetch(() => resp({ urls: [{ short_url: 'https://meli.la/abc123' }] }));
    await generateOfficialMlLink(u, cookies, { fetchImpl: fetch2 as unknown as typeof fetch });
    expect(JSON.parse(String(fetch2.mock.calls[1]?.[1]?.body)).tag).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-official-link-batch.test.ts`
Expected: FAIL (`generateOfficialMlLinks`/`ML_LINKBUILDER_BATCH_SIZE` não exportados).

- [ ] **Step 3: Substituir `official-link.ts` pelo arquivo completo**

Substituir **todo o conteúdo** de `packages/marketplaces/src/mercadolivre/official-link.ts` por:

```ts
/**
 * Gerador oficial de links de afiliado do Mercado Livre (meli.la).
 *
 * O painel de afiliados (https://www.mercadolivre.com.br/afiliados/linkbuilder) só funciona
 * logado. A extensão Afilados Connect sincroniza os cookies da sessão do usuário; aqui usamos
 * esses cookies para chamar o mesmo endpoint que o painel usa e obter o link curto oficial.
 *
 * O endpoint interno não é documentado e pode mudar — por isso é configurável via
 * ML_LINKBUILDER_ENDPOINT e o adapter sempre cai no fallback matt_word/matt_tool em caso de erro.
 *
 * Há dois métodos: `generateOfficialMlLinks` (método 1) gera várias URLs por chamada, em lotes de
 * 20; `generateOfficialMlLink` (método 2) gera uma URL por vez e é o fallback quando o lote falha.
 */

export const ML_LINKBUILDER_PAGE = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
export const ML_LINKBUILDER_ENDPOINT_DEFAULT =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

/** O gerador aceita várias URLs por chamada; o workflow de referência usa lotes de 20. */
export const ML_LINKBUILDER_BATCH_SIZE = 20;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const MELI_LINK_RE = /https?:\/\/meli\.la\/[A-Za-z0-9_-]+/;

export class MlSessionError extends Error {
  constructor(
    message: string,
    public readonly code: 'ML_SESSION_EXPIRED' | 'ML_LINKBUILDER_ERROR',
  ) {
    super(message);
    this.name = 'MlSessionError';
  }
}

export interface OfficialLinkOptions {
  endpoint?: string;
  timeoutMs?: number;
  /** Injetável em testes. */
  fetchImpl?: typeof fetch;
  /** Etiqueta de afiliado do ML; vazia/ausente = etiqueta padrão da conta. */
  tag?: string | undefined;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Extrai o token CSRF do HTML do painel, quando presente. */
export function extractCsrfToken(html: string): string | undefined {
  const patterns = [
    /"csrfToken"\s*:\s*"([^"]+)"/,
    /"csrf_token"\s*:\s*"([^"]+)"/,
    /name=["']_csrf["']\s+(?:value|content)=["']([^"']+)["']/,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Procura recursivamente o primeiro link curto meli.la em qualquer resposta JSON. */
export function findMeliLink(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const m = value.match(/https?:\/\/meli\.la\/[A-Za-z0-9_-]+/);
    return m?.[0];
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findMeliLink(v);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findMeliLink(v);
      if (found) return found;
    }
  }
  return undefined;
}

function looksLikeLogin(finalUrl: string): boolean {
  return /\/(login|registration|jms\/mlb\/lgz)/i.test(finalUrl);
}

function sessionExpired(): MlSessionError {
  return new MlSessionError(
    'Sessão do Mercado Livre expirou; sincronize pela extensão',
    'ML_SESSION_EXPIRED',
  );
}

function resolveRequestOptions(cookies: Record<string, string>, opts: OfficialLinkOptions) {
  const cookie = cookieHeader(cookies);
  if (!cookie) {
    throw new MlSessionError('Sessão do Mercado Livre não sincronizada', 'ML_SESSION_EXPIRED');
  }
  return {
    cookie,
    doFetch: opts.fetchImpl ?? fetch,
    endpoint:
      opts.endpoint ?? process.env.ML_LINKBUILDER_ENDPOINT ?? ML_LINKBUILDER_ENDPOINT_DEFAULT,
    timeoutMs: opts.timeoutMs ?? 10_000,
  };
}

interface RawResponse {
  status: number;
  ok: boolean;
  url: string;
  text: string;
}

/** Uma requisição com timeout próprio que cobre também a leitura do corpo. */
async function timedRequest(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<RawResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, ok: res.ok, url: res.url, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** Abre o painel para validar a sessão e obter o CSRF (quando presente). */
async function openLinkbuilder(
  doFetch: typeof fetch,
  cookie: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const page = await timedRequest(
    doFetch,
    ML_LINKBUILDER_PAGE,
    {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Cookie: cookie, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    },
    timeoutMs,
  );
  if (looksLikeLogin(page.url)) throw sessionExpired();
  return extractCsrfToken(page.text);
}

function postCreateLink(
  doFetch: typeof fetch,
  endpoint: string,
  cookie: string,
  csrf: string | undefined,
  urls: string[],
  tag: string,
  timeoutMs: number,
): Promise<RawResponse> {
  return timedRequest(
    doFetch,
    endpoint,
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.mercadolivre.com.br',
        Referer: ML_LINKBUILDER_PAGE,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: JSON.stringify({ urls, tag }),
    },
    timeoutMs,
  );
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Gera o link oficial meli.la para uma URL de produto usando a sessão do afiliado (método 2: uma URL
 * por chamada). Lança MlSessionError quando a sessão expirou ou o endpoint não respondeu como esperado.
 */
export async function generateOfficialMlLink(
  productUrl: string,
  cookies: Record<string, string>,
  opts: OfficialLinkOptions = {},
): Promise<string> {
  const { cookie, doFetch, endpoint, timeoutMs } = resolveRequestOptions(cookies, opts);
  const csrf = await openLinkbuilder(doFetch, cookie, timeoutMs);
  const res = await postCreateLink(
    doFetch,
    endpoint,
    cookie,
    csrf,
    [productUrl],
    opts.tag ?? '',
    timeoutMs,
  );
  if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) throw sessionExpired();
  if (!res.ok) {
    throw new MlSessionError(
      `Gerador de links do ML respondeu HTTP ${res.status}`,
      'ML_LINKBUILDER_ERROR',
    );
  }
  const link = findMeliLink(parseBody(res.text));
  if (!link) {
    throw new MlSessionError(
      'Gerador de links do ML não devolveu um link meli.la',
      'ML_LINKBUILDER_ERROR',
    );
  }
  return link;
}

export interface BatchLinkOptions extends OfficialLinkOptions {
  /** Pausa entre lotes de 20 (padrão 2,5 s); injetável em testes. */
  pauseMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface BatchLinkResult {
  /** URL enviada → link meli.la. URLs que o gerador não resolveu ficam de fora. */
  links: Map<string, string>;
  /** Lotes inteiros que falharam (HTTP de erro, resposta fora do formato…). */
  failures: { urls: string[]; message: string }[];
}

function normalizeForMatch(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname}${x.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function readEntries(parsed: unknown): { origin: string; short: string | undefined }[] {
  const list =
    parsed && typeof parsed === 'object' ? (parsed as { urls?: unknown }).urls : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((e: unknown) => {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const origin =
      typeof o.origin_url === 'string' ? o.origin_url : typeof o.url === 'string' ? o.url : '';
    const short =
      typeof o.short_url === 'string' ? o.short_url.match(MELI_LINK_RE)?.[0] : undefined;
    return { origin, short };
  });
}

/**
 * Método 1: gera os links de várias URLs de uma vez (até 20 por chamada), abrindo o painel uma única
 * vez. Um lote que falha não derruba os outros: vai para `failures` e quem chamou decide o fallback
 * (método 2). Sessão expirada interrompe tudo com `MlSessionError('ML_SESSION_EXPIRED')`.
 */
export async function generateOfficialMlLinks(
  urls: string[],
  cookies: Record<string, string>,
  opts: BatchLinkOptions = {},
): Promise<BatchLinkResult> {
  const links = new Map<string, string>();
  const failures: BatchLinkResult['failures'] = [];
  const unique = [...new Set(urls)];
  const { cookie, doFetch, endpoint, timeoutMs } = resolveRequestOptions(cookies, opts);
  if (unique.length === 0) return { links, failures };

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pauseMs = opts.pauseMs ?? 2500;
  const tag = opts.tag ?? '';
  const csrf = await openLinkbuilder(doFetch, cookie, timeoutMs);

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ML_LINKBUILDER_BATCH_SIZE) {
    chunks.push(unique.slice(i, i + ML_LINKBUILDER_BATCH_SIZE));
  }

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) await sleep(pauseMs);
    try {
      const res = await postCreateLink(doFetch, endpoint, cookie, csrf, chunk, tag, timeoutMs);
      if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) {
        throw sessionExpired();
      }
      if (!res.ok) {
        failures.push({
          urls: chunk,
          message: `Gerador de links do ML respondeu HTTP ${res.status}`,
        });
        continue;
      }
      const parsed = parseBody(res.text);
      const entries = readEntries(parsed);
      if (entries.length === 0) {
        const single = chunk.length === 1 ? findMeliLink(parsed) : undefined;
        if (single) links.set(chunk[0]!, single);
        else {
          failures.push({
            urls: chunk,
            message: 'Gerador de links do ML não devolveu a lista de links',
          });
        }
        continue;
      }
      const byNormalized = new Map(chunk.map((u) => [normalizeForMatch(u), u] as const));
      for (const { origin, short } of entries) {
        const sent = chunk.includes(origin) ? origin : byNormalized.get(normalizeForMatch(origin));
        if (sent && short) links.set(sent, short);
      }
    } catch (err) {
      if (err instanceof MlSessionError) throw err;
      failures.push({ urls: chunk, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { links, failures };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-official-link-batch.test.ts test/ml-official-link.test.ts test/tag-adapter-ml-api.test.ts test/tag-adapter.test.ts`
Expected: PASS (os testes antigos do método 2 continuam verdes).

Run: `pnpm --filter @afilados/marketplaces exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/marketplaces/src/mercadolivre/official-link.ts packages/marketplaces/test/ml-official-link-batch.test.ts
git add packages/marketplaces
git commit -m "feat(marketplaces): gerador de links meli.la em lote de 20 com etiqueta

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pré-aquecimento (orquestração + chaves) e etiqueta no adapter

**Files:**
- Create: `packages/marketplaces/src/mercadolivre/links-prewarm.ts`
- Modify: `packages/marketplaces/src/tag-adapter.ts:37-41, 105-110, 201-216`
- Modify: `packages/marketplaces/src/index.ts`
- Modify: `packages/shared/src/marketplaces.ts` (comentário de `TagCredentials.tag`)
- Test: `packages/marketplaces/test/ml-links-prewarm.test.ts` (criar)

**Interfaces:**
- Consumes: `generateOfficialMlLinks`, `generateOfficialMlLink`, `BatchLinkResult`, `MlSessionError` (Task 4).
- Produces:
  - `ML_AFF_LINK_TTL_SEC = 86400`
  - `mlAffLinkKey(tenantId: string, tag: string | undefined, url: string): string`
  - `mlLinksErrorKey(tenantId: string): string`
  - `interface MlLinkBatchError { at: string; message: string; urls: number; recoveredByFallback: number }`
  - `interface PrewarmDeps { generateBatch(urls: string[]): Promise<BatchLinkResult>; generateSingle(url: string): Promise<string>; store(url: string, link: string): Promise<void>; recordError(e: MlLinkBatchError): Promise<void>; clearError(): Promise<void>; sleep(ms: number): Promise<void>; now?: () => Date; fallbackPauseMs?: number }`
  - `interface PrewarmResult { viaBatch: number; viaFallback: number; failed: number; sessionExpired: boolean }`
  - `prewarmMlAffiliateLinks(urls: string[], deps: PrewarmDeps): Promise<PrewarmResult>`
  - `createTagAdapter(...).opts.mlOfficialLink` passa a receber `(url, cookies, tag?)`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `packages/marketplaces/test/ml-links-prewarm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createTagAdapter,
  ML_AFF_LINK_TTL_SEC,
  MlSessionError,
  mlAffLinkKey,
  mlLinksErrorKey,
  prewarmMlAffiliateLinks,
  type BatchLinkResult,
  type MlLinkBatchError,
  type PrewarmDeps,
} from '../src';

const NOW = new Date('2026-10-05T17:30:00.000Z');
const U = (n: number) => `https://www.mercadolivre.com.br/p/MLB${n}`;

function makeDeps(over: Partial<PrewarmDeps> = {}) {
  const stored = new Map<string, string>();
  const errors: MlLinkBatchError[] = [];
  const deps: PrewarmDeps = {
    generateBatch: vi.fn(
      async (urls: string[]): Promise<BatchLinkResult> => ({
        links: new Map(urls.map((u) => [u, `https://meli.la/${u.slice(-3)}`])),
        failures: [],
      }),
    ),
    generateSingle: vi.fn(async (u: string) => `https://meli.la/single-${u.slice(-3)}`),
    store: vi.fn(async (u: string, l: string) => {
      stored.set(u, l);
    }),
    recordError: vi.fn(async (e: MlLinkBatchError) => {
      errors.push(e);
    }),
    clearError: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    now: () => NOW,
    fallbackPauseMs: 1000,
    ...over,
  };
  return { deps, stored, errors };
}

describe('chaves do Redis', () => {
  it('chave do link inclui tenant, etiqueta (ou default) e o sha1 da URL', () => {
    const a = mlAffLinkKey('t1', 'minha', U(1));
    const b = mlAffLinkKey('t1', undefined, U(1));
    expect(a).toMatch(/^ml-aff-link:t1:minha:[0-9a-f]{40}$/);
    expect(b).toMatch(/^ml-aff-link:t1:default:[0-9a-f]{40}$/);
    expect(mlAffLinkKey('t1', '  ', U(1))).toBe(b);
    expect(mlAffLinkKey('t2', 'minha', U(1))).not.toBe(a);
    expect(mlAffLinkKey('t1', 'minha', U(2))).not.toBe(a);
    expect(ML_AFF_LINK_TTL_SEC).toBe(86400);
    expect(mlLinksErrorKey('t1')).toBe('ml-links-batch:last-error:t1');
  });
});

describe('prewarmMlAffiliateLinks', () => {
  it('tudo pelo lote: guarda os links e limpa o erro anterior', async () => {
    const { deps, stored } = makeDeps();
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(2)], deps);
    expect(r).toEqual({ viaBatch: 2, viaFallback: 0, failed: 0, sessionExpired: false });
    expect(stored.size).toBe(2);
    expect(deps.generateSingle).not.toHaveBeenCalled();
    expect(deps.clearError).toHaveBeenCalledTimes(1);
    expect(deps.recordError).not.toHaveBeenCalled();
  });

  it('lote lança erro: cai no método individual, guarda o erro com o que foi salvo', async () => {
    const { deps, stored, errors } = makeDeps({
      generateBatch: vi.fn(async () => {
        throw new Error('formato de resposta mudou');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(r).toEqual({ viaBatch: 0, viaFallback: 3, failed: 0, sessionExpired: false });
    expect(stored.size).toBe(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(1000);
    expect(errors).toEqual([
      {
        at: NOW.toISOString(),
        message: 'formato de resposta mudou',
        urls: 3,
        recoveredByFallback: 3,
      },
    ]);
    expect(deps.clearError).not.toHaveBeenCalled();
  });

  it('lote devolve só parte: o que faltou vai para o método individual', async () => {
    const { deps, stored, errors } = makeDeps({
      generateBatch: vi.fn(async (urls: string[]) => ({
        links: new Map([[urls[0]!, 'https://meli.la/ok']]),
        failures: [],
      })),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2)], deps);
    expect(r).toMatchObject({ viaBatch: 1, viaFallback: 1, failed: 0 });
    expect(stored.get(U(2))).toBe('https://meli.la/single-002');
    expect(errors[0]).toMatchObject({ urls: 1, recoveredByFallback: 1 });
    expect(errors[0]?.message).toMatch(/não devolveu/i);
  });

  it('usa a mensagem da falha do lote quando existe', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async (urls: string[]) => ({
        links: new Map(),
        failures: [{ urls, message: 'Gerador de links do ML respondeu HTTP 500' }],
      })),
    });
    await prewarmMlAffiliateLinks([U(1)], deps);
    expect(errors[0]?.message).toBe('Gerador de links do ML respondeu HTTP 500');
  });

  it('método individual também falha em alguns: conta como failed e informa quantos foram salvos', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async () => ({ links: new Map(), failures: [] })),
      generateSingle: vi.fn(async (u: string) => {
        if (u === U(2)) throw new MlSessionError('x', 'ML_LINKBUILDER_ERROR');
        return `https://meli.la/${u.slice(-3)}`;
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(r).toMatchObject({ viaFallback: 2, failed: 1 });
    expect(errors[0]).toMatchObject({ urls: 3, recoveredByFallback: 2 });
  });

  it('sessão expirada no lote: não usa o método individual e registra o erro', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async () => {
        throw new MlSessionError('Sessão do Mercado Livre expirou', 'ML_SESSION_EXPIRED');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2)], deps);
    expect(r).toEqual({ viaBatch: 0, viaFallback: 0, failed: 2, sessionExpired: true });
    expect(deps.generateSingle).not.toHaveBeenCalled();
    expect(errors[0]).toMatchObject({ urls: 2, recoveredByFallback: 0 });
    expect(errors[0]?.message).toMatch(/expirou/);
  });

  it('sessão expira no meio do método individual: interrompe os que faltam', async () => {
    const { deps } = makeDeps({
      generateBatch: vi.fn(async () => ({ links: new Map(), failures: [] })),
      generateSingle: vi.fn(async () => {
        throw new MlSessionError('Sessão expirou', 'ML_SESSION_EXPIRED');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(deps.generateSingle).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ failed: 3, sessionExpired: true });
  });

  it('lista vazia não chama nada', async () => {
    const { deps } = makeDeps();
    expect(await prewarmMlAffiliateLinks([], deps)).toEqual({
      viaBatch: 0,
      viaFallback: 0,
      failed: 0,
      sessionExpired: false,
    });
    expect(deps.generateBatch).not.toHaveBeenCalled();
    expect(deps.clearError).not.toHaveBeenCalled();
  });
});

describe('adapter do ML com etiqueta', () => {
  const cookies = { ssid: 'abc' };
  const session = { cookies, syncedAt: '2026-10-05T00:00:00Z' };

  it('repassa a etiqueta ao gerador e não mistura o cache de etiquetas diferentes', async () => {
    const gen = vi.fn(
      async (_u: string, _c: Record<string, string>, tag?: string) =>
        `https://meli.la/${tag ?? 'padrao'}`,
    );
    const adapter = createTagAdapter('MERCADOLIVRE', { mlOfficialLink: gen });
    const url = 'https://www.mercadolivre.com.br/p/MLB555';
    const withTag = { mlSession: session, tag: 'etq' };
    expect(await adapter.toAffiliateLink(withTag, url)).toBe('https://meli.la/etq');
    expect(await adapter.toAffiliateLink(withTag, url)).toBe('https://meli.la/etq');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenLastCalledWith(url, cookies, 'etq');
    expect(await adapter.toAffiliateLink({ mlSession: session }, url)).toBe(
      'https://meli.la/padrao',
    );
    expect(gen).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run test/ml-links-prewarm.test.ts`
Expected: FAIL (`prewarmMlAffiliateLinks`, `mlAffLinkKey`… não exportados).

- [ ] **Step 3: Implementar `links-prewarm.ts`**

Criar `packages/marketplaces/src/mercadolivre/links-prewarm.ts`:

```ts
import { createHash } from 'node:crypto';
import { MlSessionError, type BatchLinkResult } from './official-link';

/** Links meli.la gerados ficam 24 h no Redis (compartilhado entre API e worker). */
export const ML_AFF_LINK_TTL_SEC = 24 * 60 * 60;

export function mlAffLinkKey(tenantId: string, tag: string | undefined, url: string): string {
  const scope = tag?.trim() || 'default';
  return `ml-aff-link:${tenantId}:${scope}:${createHash('sha1').update(url).digest('hex')}`;
}

/** Último erro do gerador em lote (método 1), lido pela tela de Marketplaces. */
export function mlLinksErrorKey(tenantId: string): string {
  return `ml-links-batch:last-error:${tenantId}`;
}

export interface MlLinkBatchError {
  /** ISO 8601. */
  at: string;
  message: string;
  /** Quantas URLs o método 1 não resolveu. */
  urls: number;
  /** Quantas dessas foram salvas pelo método individual (método 2). */
  recoveredByFallback: number;
}

export interface PrewarmDeps {
  /** Método 1: gera em lote (padrão: `generateOfficialMlLinks`). */
  generateBatch: (urls: string[]) => Promise<BatchLinkResult>;
  /** Método 2: uma URL por vez (padrão: `generateOfficialMlLink`). */
  generateSingle: (url: string) => Promise<string>;
  store: (url: string, link: string) => Promise<void>;
  recordError: (error: MlLinkBatchError) => Promise<void>;
  clearError: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Pausa entre chamadas do método individual (padrão 1 s). */
  fallbackPauseMs?: number;
}

export interface PrewarmResult {
  viaBatch: number;
  viaFallback: number;
  failed: number;
  sessionExpired: boolean;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Gera e guarda os links de afiliado antes do envio. Tenta o método 1 (lote); o que ele não resolver
 * cai no método 2 (individual). Sessão expirada interrompe tudo, porque o método 2 falharia igual.
 * O resultado do método 1 fica registrado: erro (com quantos o método 2 salvou) ou limpeza do erro.
 */
export async function prewarmMlAffiliateLinks(
  urls: string[],
  deps: PrewarmDeps,
): Promise<PrewarmResult> {
  const now = deps.now ?? (() => new Date());
  const pauseMs = deps.fallbackPauseMs ?? 1000;
  const unique = [...new Set(urls)];
  const result: PrewarmResult = { viaBatch: 0, viaFallback: 0, failed: 0, sessionExpired: false };
  if (unique.length === 0) return result;

  let batch: BatchLinkResult;
  try {
    batch = await deps.generateBatch(unique);
  } catch (err) {
    if (err instanceof MlSessionError && err.code === 'ML_SESSION_EXPIRED') {
      result.failed = unique.length;
      result.sessionExpired = true;
      await deps.recordError({
        at: now().toISOString(),
        message: err.message,
        urls: unique.length,
        recoveredByFallback: 0,
      });
      return result;
    }
    batch = { links: new Map(), failures: [{ urls: unique, message: errMessage(err) }] };
  }

  for (const [url, link] of batch.links) {
    await deps.store(url, link);
    result.viaBatch++;
  }

  const missing = unique.filter((u) => !batch.links.has(u));
  for (const [i, url] of missing.entries()) {
    if (result.sessionExpired) {
      result.failed++;
      continue;
    }
    if (i > 0) await deps.sleep(pauseMs);
    try {
      await deps.store(url, await deps.generateSingle(url));
      result.viaFallback++;
    } catch (err) {
      result.failed++;
      if (err instanceof MlSessionError && err.code === 'ML_SESSION_EXPIRED') {
        result.sessionExpired = true;
      }
    }
  }

  if (missing.length > 0) {
    await deps.recordError({
      at: now().toISOString(),
      message:
        batch.failures[0]?.message ?? 'O gerador em lote não devolveu o link de algumas URLs',
      urls: missing.length,
      recoveredByFallback: result.viaFallback,
    });
  } else {
    await deps.clearError();
  }
  return result;
}
```

Em `packages/marketplaces/src/index.ts`, após o export de `./mercadolivre/listing`:

```ts
export * from './mercadolivre/links-prewarm';
```

- [ ] **Step 4: Etiqueta no adapter**

Em `packages/marketplaces/src/tag-adapter.ts`:

1. Na interface `TagAdapterOptions`, trocar a assinatura de `mlOfficialLink`:

```ts
  /** Gerador do link oficial meli.la (injetável em testes); `tag` é a etiqueta de afiliado do ML. */
  mlOfficialLink?: (
    url: string,
    cookies: Record<string, string>,
    tag?: string,
  ) => Promise<string>;
```

2. Em `createTagAdapter`, trocar o default de `officialLink`:

```ts
  const officialLink =
    opts.mlOfficialLink ?? ((url, cookies, tag) => generateOfficialMlLink(url, cookies, { tag }));
```

3. No bloco `toAffiliateLink` do ML, trocar a chave de cache e a chamada:

```ts
      if (kind === 'MERCADOLIVRE' && creds.mlSession?.cookies) {
        const cacheKey = `MERCADOLIVRE:${creds.tag?.trim() ?? ''}:${url}`;
        const cached = officialLinkCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.link;
        try {
          const link = await officialLink(
            url,
            creds.mlSession.cookies,
            creds.tag?.trim() || undefined,
          );
```

(o restante do bloco — `officialLinkCache.set`, `return link`, o `catch` com `onOfficialLinkError` — fica igual.)

4. Em `packages/shared/src/marketplaces.ts`, no comentário de `tag?: string;` de `TagCredentials`, acrescentar ao final do texto: ` Mercado Livre: etiqueta de afiliado usada no gerador meli.la (vazio = etiqueta padrão da conta)`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/marketplaces exec vitest run`
Expected: PASS em todo o pacote (os testes antigos de `tag-adapter` e `ml-official-link` incluídos).

Run: `pnpm --filter @afilados/marketplaces exec tsc --noEmit && pnpm --filter @afilados/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/marketplaces/src packages/marketplaces/test/ml-links-prewarm.test.ts packages/shared/src/marketplaces.ts
git add packages
git commit -m "feat(marketplaces): pré-aquecimento de links com fallback e etiqueta do ML

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: API — `POST /products/search` com `mode: 'listing'`

**Files:**
- Modify: `apps/api/src/lib/ml-api.ts` (acrescentar `loadMlSessionCookies`)
- Create: `apps/api/src/lib/ml-listing.ts`
- Modify: `apps/api/src/routes/products.ts:17-22, 113-119`
- Test: `apps/api/test/ml-listing-search.test.ts` (criar)

**Interfaces:**
- Consumes: `fetchMlListing`, `MlListingError`, `MlListingSource` (Tasks 2–3); `MlListingQuery` (Task 1).
- Produces: `loadMlSessionCookies(db: TenantClient): Promise<Record<string, string> | undefined>`; `mlListingDeps: { fetchMlListing }` (mutável nos testes); `toMlListingSource(l: MlListingQuery): MlListingSource`; `mapMlListingError(e: unknown, hadSession: boolean): ApiError`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/ml-listing-search.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { MlListingError } from '@afilados/marketplaces';
import type { ProductData } from '@afilados/shared';
import { buildApp } from '../src/app';
import { mlListingDeps } from '../src/lib/ml-listing';
import { cleanupTenant, createTenantWithUser, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
const realFetch = mlListingDeps.fetchMlListing;
const fetchMock = vi.fn();
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;

const sample = (n: number, over: Partial<ProductData> = {}): ProductData => ({
  source: 'MERCADOLIVRE',
  externalId: `MLB${n}`,
  title: `Produto ${n}`,
  price: 100 + n,
  originalPrice: 200,
  discountPct: 50,
  images: ['https://http2.mlstatic.com/D_1.webp'],
  shipping: 'FULL',
  originalUrl: `https://www.mercadolivre.com.br/produto/p/MLB${n}`,
  raw: { origin: 'ml-listing' },
  ...over,
});

const search = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/v1/products/search', headers: { cookie }, payload });

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
beforeEach(() => {
  fetchMock.mockReset();
  mlListingDeps.fetchMlListing = fetchMock as unknown as typeof realFetch;
});
afterAll(async () => {
  mlListingDeps.fetchMlListing = realFetch;
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('POST /products/search (listing do ML)', () => {
  it('devolve e persiste os produtos da listagem', async () => {
    fetchMock.mockResolvedValue([sample(1), sample(2)]);
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'category', categoryId: 'MLB1051' },
      limit: 20,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(2);
    expect(typeof r.json().products[0].price).toBe('number');
    expect(await prisma.product.count({ where: { tenantId: t.tenantId } })).toBe(2);
    const [source, opts] = fetchMock.mock.calls[0] as [
      unknown,
      { limit: number; cookies?: unknown },
    ];
    expect(source).toEqual({ kind: 'category', categoryId: 'MLB1051' });
    expect(opts.limit).toBe(20);
    expect(opts.cookies).toBeUndefined();
  });

  it('usa os cookies da sessão sincronizada do ML quando existem', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: t.tenantId,
        kind: 'MERCADOLIVRE',
        encryptedCredentials: encryptJson({
          mlSession: {
            cookies: { ssid: 'abc' },
            syncedAt: '2026-10-05T00:00:00Z',
            source: 'manual',
          },
        }),
      },
    });
    fetchMock.mockResolvedValue([sample(3)]);
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]?.[1] as { cookies?: unknown }).cookies).toEqual({
      ssid: 'abc',
    });
    await prisma.marketplaceConnection.deleteMany({ where: { tenantId: t.tenantId } });
  });

  it('passa um filtro que aplica desconto mínimo, preço e frete grátis', async () => {
    fetchMock.mockResolvedValue([]);
    await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'lightning' },
      minDiscountPct: 40,
      maxPrice: 300,
      freeShippingOnly: true,
    });
    const filter = (fetchMock.mock.calls[0]?.[1] as { filter: (p: ProductData) => boolean }).filter;
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'FREE' }))).toBe(true);
    expect(filter(sample(1, { discountPct: 10, price: 100, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 400, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'FULL' }))).toBe(false);
  });

  it('bloqueio do ML → 502 com orientação para sincronizar a sessão', async () => {
    fetchMock.mockRejectedValue(new MlListingError('x', 'ML_LISTING_BLOCKED'));
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/Afilados Connect/);
  });

  it('layout mudou → 502 com mensagem clara', async () => {
    fetchMock.mockRejectedValue(new MlListingError('x', 'ML_LISTING_LAYOUT', 'url (10 bytes)'));
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/layout/i);
  });

  it('URL inválida → 400', async () => {
    fetchMock.mockRejectedValue(
      new MlListingError('Use um link https do Mercado Livre', 'ML_LISTING_INVALID_URL'),
    );
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'url', url: 'https://evil.com/x' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejeita listing fora do Mercado Livre e sem mlListing', async () => {
    expect(
      (await search({ source: 'SHOPEE', mode: 'listing', mlListing: { kind: 'deals' } }))
        .statusCode,
    ).toBe(400);
    expect((await search({ source: 'MERCADOLIVRE', mode: 'listing' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/api exec vitest run test/ml-listing-search.test.ts`
Expected: FAIL (`../src/lib/ml-listing` inexistente).

- [ ] **Step 3: Implementar**

Em `apps/api/src/lib/ml-api.ts`, ao final do arquivo:

```ts
/**
 * Cookies da sessão sincronizada do ML (extensão ou colagem manual), ou undefined. Não renova o
 * token da API oficial: serve à busca por listagem, que só precisa dos cookies como segunda tentativa.
 */
export async function loadMlSessionCookies(
  db: TenantClient,
): Promise<Record<string, string> | undefined> {
  const { creds } = await readCreds(db);
  const cookies = creds.mlSession?.cookies;
  return cookies && Object.keys(cookies).length > 0 ? cookies : undefined;
}
```

Criar `apps/api/src/lib/ml-listing.ts`:

```ts
import { fetchMlListing, MlListingError, type MlListingSource } from '@afilados/marketplaces';
import { ApiError, type MlListingQuery } from '@afilados/shared';

/** Indireção para os testes trocarem a busca real (que acessa o ML) por um dublê. */
export const mlListingDeps = { fetchMlListing };

/** O schema (`searchQuerySchema`) já garante categoryId/url quando o tipo exige. */
export function toMlListingSource(l: MlListingQuery): MlListingSource {
  switch (l.kind) {
    case 'category':
      return { kind: 'category', categoryId: l.categoryId! };
    case 'url':
      return { kind: 'url', url: l.url! };
    case 'lightning':
      return { kind: 'lightning' };
    default:
      return { kind: 'deals' };
  }
}

export function mapMlListingError(e: unknown, hadSession: boolean): ApiError {
  if (e instanceof MlListingError) {
    switch (e.code) {
      case 'ML_LISTING_INVALID_URL':
        return ApiError.validation(e.message);
      case 'ML_LISTING_BLOCKED':
        return new ApiError(
          'MARKETPLACE_ERROR',
          hadSession
            ? 'O Mercado Livre bloqueou a listagem mesmo com a sessão sincronizada; a sessão pode ter expirado. Sincronize de novo pela extensão Afilados Connect'
            : 'O Mercado Livre bloqueou a listagem. Sincronize a sessão pela extensão Afilados Connect e tente de novo',
          502,
        );
      case 'ML_LISTING_LAYOUT':
        return new ApiError(
          'MARKETPLACE_ERROR',
          'A página de ofertas do Mercado Livre mudou de layout e não foi possível ler os produtos',
          502,
        );
      default:
        return new ApiError('MARKETPLACE_ERROR', e.message, 502);
    }
  }
  return new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
}
```

Em `apps/api/src/routes/products.ts`:

1. Trocar o import de `@afilados/marketplaces` para incluir `MlListingError`:

```ts
import {
  discoverAmazonByKeyword,
  discoverMercadoLivreByKeyword,
  discoverMlCatalogUrls,
  discoverMagaluByKeyword,
  MlListingError,
} from '@afilados/marketplaces';
```

2. Trocar `import { loadFetchCredentials } from '../lib/ml-api';` por:

```ts
import { loadFetchCredentials, loadMlSessionCookies } from '../lib/ml-api';
import { mapMlListingError, mlListingDeps, toMlListingSource } from '../lib/ml-listing';
```

3. Em `/products/search`, **antes** do comentário `// Mercado Livre, Amazon e Magalu não têm API de catálogo/categoria…`, inserir:

```ts
    // Mercado Livre por listagem de ofertas (a busca por palavra-chave é bloqueada pelo anti-bot).
    if (q.mode === 'listing') {
      const cookies = await loadMlSessionCookies(req.db);
      let found: ProductData[];
      try {
        found = await mlListingDeps.fetchMlListing(toMlListingSource(q.mlListing!), {
          limit: q.limit,
          // filtra durante a paginação para juntar `limit` produtos que passem nos filtros
          filter: (p) => applySearchFilters([p], q).length > 0,
          ...(cookies ? { cookies } : {}),
        });
      } catch (e) {
        if (e instanceof MlListingError && e.details) {
          req.log.warn({ code: e.code, details: e.details }, 'busca por listagem do ML falhou');
        }
        throw mapMlListingError(e, Boolean(cookies));
      }
      const rows = await upsertProducts(req.db, req.tenantId, found);
      return { products: rows.map(toApiProduct) };
    }

```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/api exec vitest run test/ml-listing-search.test.ts test/products.test.ts`
Expected: PASS (Postgres e Redis no ar).

Run: `pnpm --filter @afilados/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src apps/api/test/ml-listing-search.test.ts
git add apps/api
git commit -m "feat(api): busca de produtos do ML por listagem de ofertas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API — etiqueta, erro do lote no card e enfileiramento do pré-aquecimento

**Files:**
- Create: `apps/api/src/lib/ml-links.ts`
- Modify: `apps/api/src/lib/marketplaces.ts:68-73`
- Modify: `apps/api/src/routes/marketplaces.ts:36-41, 68-76`
- Modify: `apps/api/src/routes/queue.ts:59-68`
- Modify: `apps/api/src/routes/batches.ts` (rota `send-products`, após `addProductsToBatch`)
- Test: `apps/api/test/ml-links.test.ts` (criar)

**Interfaces:**
- Consumes: `mlLinksErrorKey`, `MlLinkBatchError` (Task 5); `QUEUE_ML_LINKS_PREWARM`, `MlLinksPrewarmJob`, `marketplaceUpdateSchema.mlTag` (Task 1).
- Produces: `readMlLinkBatchError(tenantId): Promise<MlLinkBatchError | null>`; `enqueueMlLinksPrewarm(db, tenantId, productIds): Promise<number>`; `publicConnection(...).mlAffiliateTag: string | null`; `GET /marketplaces` → item do ML com `mlLinkBatchError: MlLinkBatchError | null`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/ml-links.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@afilados/db';
import { QUEUE_ML_LINKS_PREWARM, type MlLinksPrewarmJob } from '@afilados/shared';
import { mlLinksErrorKey } from '@afilados/marketplaces';
import { buildApp } from '../src/app';
import { getQueue, getRedis } from '../src/lib/redis';
import { cleanupTenant, createTenantWithUser, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
afterAll(async () => {
  await getRedis().del(mlLinksErrorKey(t.tenantId));
  await cleanupTenant(t.tenantId);
  await app.close();
});

const put = (payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/marketplaces/MERCADOLIVRE',
    headers: { cookie },
    payload,
  });

describe('etiqueta de afiliado do ML', () => {
  it('grava mlTag, expõe mlAffiliateTag e permite limpar com vazio', async () => {
    const r1 = await put({ mattWord: 'w', mattTool: '1', mlTag: ' minha-tag ' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().mlAffiliateTag).toBe('minha-tag');

    // preserva a etiqueta quando o campo não vem no corpo
    const r2 = await put({ mattWord: 'w2' });
    expect(r2.json().mlAffiliateTag).toBe('minha-tag');
    expect(r2.json().mattTool).toBe('1');

    const r3 = await put({ mlTag: '' });
    expect(r3.json().mlAffiliateTag).toBeNull();
    expect(r3.json().mattWord).toBe('w2');
  });

  it('outros marketplaces não expõem etiqueta do ML', async () => {
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlAffiliateTag: string | null }[];
    expect(list.find((m) => m.kind === 'AMAZON')?.mlAffiliateTag).toBeNull();
  });
});

describe('erro do gerador em lote no card do ML', () => {
  it('GET /marketplaces anexa o último erro só ao Mercado Livre', async () => {
    const err = {
      at: '2026-10-05T17:30:00.000Z',
      message: 'Gerador de links do ML respondeu HTTP 500',
      urls: 5,
      recoveredByFallback: 3,
    };
    await getRedis().set(mlLinksErrorKey(t.tenantId), JSON.stringify(err));
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlLinkBatchError?: unknown }[];
    expect(list.find((m) => m.kind === 'MERCADOLIVRE')?.mlLinkBatchError).toEqual(err);
    expect(list.find((m) => m.kind === 'SHOPEE')?.mlLinkBatchError).toBeUndefined();

    await getRedis().del(mlLinksErrorKey(t.tenantId));
    const after = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlLinkBatchError?: unknown }[];
    expect(after.find((m) => m.kind === 'MERCADOLIVRE')?.mlLinkBatchError).toBeNull();
  });
});

describe('pré-aquecimento ao salvar na fila', () => {
  it('POST /queue enfileira só as URLs de produtos do ML', async () => {
    const queue = getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM);
    await queue.drain();
    const ml = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'MERCADOLIVRE',
        externalId: 'MLB1234',
        title: 'Produto ML',
        price: 10,
        originalUrl: 'https://www.mercadolivre.com.br/produto/p/MLB1234',
        raw: {},
      },
    });
    const shopee = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'SHOPEE',
        externalId: '99',
        title: 'Produto Shopee',
        price: 10,
        originalUrl: 'https://shopee.com.br/x-i.1.99',
        raw: {},
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: [ml.id, shopee.id] },
    });
    expect(r.statusCode).toBe(201);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    const mine = jobs.filter((j) => j.data.tenantId === t.tenantId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.data.urls).toEqual(['https://www.mercadolivre.com.br/produto/p/MLB1234']);
    for (const j of mine) await j.remove().catch(() => {});
  });

  it('não enfileira nada quando não há produto do ML', async () => {
    const queue = getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM);
    await queue.drain();
    const only = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'SHOPEE',
        externalId: '100',
        title: 'Outro',
        price: 10,
        originalUrl: 'https://shopee.com.br/x-i.1.100',
        raw: {},
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: [only.id] },
    });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    expect(jobs.filter((j) => j.data.tenantId === t.tenantId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/api exec vitest run test/ml-links.test.ts`
Expected: FAIL (`mlAffiliateTag` ausente, nada enfileirado).

- [ ] **Step 3: Implementar**

Criar `apps/api/src/lib/ml-links.ts`:

```ts
import type { TenantClient } from '@afilados/db';
import { mlLinksErrorKey, type MlLinkBatchError } from '@afilados/marketplaces';
import { QUEUE_ML_LINKS_PREWARM, type MlLinksPrewarmJob } from '@afilados/shared';
import { getQueue, getRedis } from './redis';

/** Último erro do gerador de links em lote (método 1), gravado pelo worker; null quando não há. */
export async function readMlLinkBatchError(tenantId: string): Promise<MlLinkBatchError | null> {
  const raw = await getRedis()
    .get(mlLinksErrorKey(tenantId))
    .catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MlLinkBatchError;
  } catch {
    return null;
  }
}

/**
 * Pede ao worker para gerar antecipadamente os links meli.la dos produtos do ML (quando salvos na
 * fila ou levados a um lote), para o envio já encontrá-los prontos. Devolve quantas URLs foram pedidas.
 */
export async function enqueueMlLinksPrewarm(
  db: TenantClient,
  tenantId: string,
  productIds: string[],
): Promise<number> {
  if (productIds.length === 0) return 0;
  const products = await db.product.findMany({
    where: { id: { in: productIds }, source: 'MERCADOLIVRE' },
    select: { originalUrl: true },
  });
  const urls = [...new Set(products.map((p) => p.originalUrl))];
  if (urls.length === 0) return 0;
  await getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM).add(
    'prewarm',
    { tenantId, urls },
    { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
  );
  return urls.length;
}
```

Em `apps/api/src/lib/marketplaces.ts`, em `publicConnection`, logo após a linha `mattTool: creds?.mattTool ?? null,`:

```ts
    // Etiqueta de afiliado do ML (campo `tag` das credenciais só é do ML nesta conexão)
    mlAffiliateTag: kind === 'MERCADOLIVRE' ? (creds?.tag ?? null) : null,
```

Em `apps/api/src/routes/marketplaces.ts`:

1. Import: `import { readMlLinkBatchError } from '../lib/ml-links';`
2. Trocar o handler de `GET /marketplaces`:

```ts
  app.get('/marketplaces', async (req) => {
    const rows = await req.db.marketplaceConnection.findMany();
    const mlLinkBatchError = await readMlLinkBatchError(req.tenantId);
    return MARKETPLACE_KINDS.map((kind) => {
      const conn = publicConnection(rows.find((r) => r.kind === kind) ?? null, kind);
      return kind === 'MERCADOLIVRE' ? { ...conn, mlLinkBatchError } : conn;
    });
  });
```

3. No ramo `kind === 'MERCADOLIVRE'` do PUT, depois da linha `mattTool: body.mattTool ?? prev.mattTool,` inserir:

```ts
                    // etiqueta do gerador meli.la; string vazia limpa (volta à etiqueta padrão da conta)
                    tag: body.mlTag !== undefined ? body.mlTag || undefined : prev.tag,
```

Em `apps/api/src/routes/queue.ts`:

1. Import: `import { enqueueMlLinksPrewarm } from '../lib/ml-links';`
2. Em `POST /queue`, dentro de `if (valid.length) { ... }`, logo após o `await req.db.queueItem.createMany({...});`:

```ts
      // não deve impedir salvar na fila se o Redis/worker estiver indisponível
      await enqueueMlLinksPrewarm(req.db, req.tenantId, valid).catch((err) =>
        req.log.warn({ err }, 'falha ao enfileirar o pré-aquecimento de links do ML'),
      );
```

Em `apps/api/src/routes/batches.ts`:

1. Import: `import { enqueueMlLinksPrewarm } from '../lib/ml-links';`
2. Na rota `POST /batches/:id/send-products`, logo após o `const res = await addProductsToBatch({...});`:

```ts
    await enqueueMlLinksPrewarm(req.db, req.tenantId, uniqueProductIds).catch((err) =>
      req.log.warn({ err }, 'falha ao enfileirar o pré-aquecimento de links do ML'),
    );
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/api exec vitest run test/ml-links.test.ts test/marketplaces.test.ts test/batch-send-products.test.ts test/products.test.ts`
Expected: PASS.

Run: `pnpm --filter @afilados/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src apps/api/test/ml-links.test.ts
git add apps/api
git commit -m "feat(api): etiqueta do ML, erro do lote no card e pré-aquecimento de links

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Worker — processor `ml-links-prewarm` e cache de link no envio

**Files:**
- Create: `apps/worker/src/lib/ml-links.ts`
- Create: `apps/worker/src/processors/ml-links-prewarm.ts`
- Modify: `apps/worker/src/processors/send-offer.ts:233-252`
- Modify: `apps/worker/src/processors/send-telegram.ts:124-141`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/ml-link-cache.test.ts` e `apps/worker/test/ml-links-prewarm.test.ts` (criar)

**Interfaces:**
- Consumes: `mlAffLinkKey`, `ML_AFF_LINK_TTL_SEC`, `mlLinksErrorKey`, `prewarmMlAffiliateLinks`, `generateOfficialMlLink(s)` (Tasks 4–5); `QUEUE_ML_LINKS_PREWARM`, `MlLinksPrewarmJob` (Task 1); `loadTagCredentials` (existente).
- Produces: `interface LinkStore { get; set; del }`; `redisLinkStore(): LinkStore`; `withMlLinkCache(tenantId, tag, url, generate, store?): Promise<string>`; `runMlLinksPrewarm(deps, job)`; `createMlLinksPrewarmProcessor(deps?)`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/worker/test/ml-link-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mlAffLinkKey } from '@afilados/marketplaces';
import { withMlLinkCache, type LinkStore } from '../src/lib/ml-links';

function memoryStore(): LinkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
    del: async (k) => {
      data.delete(k);
    },
  };
}

const URL1 = 'https://www.mercadolivre.com.br/p/MLB1';

describe('withMlLinkCache', () => {
  it('devolve o link em cache sem gerar de novo', async () => {
    const store = memoryStore();
    store.data.set(mlAffLinkKey('t1', 'etq', URL1), 'https://meli.la/cached');
    const generate = vi.fn(async () => 'https://meli.la/new');
    expect(await withMlLinkCache('t1', 'etq', URL1, generate, store)).toBe(
      'https://meli.la/cached',
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('gera e guarda quando o link é um meli.la', async () => {
    const store = memoryStore();
    const generate = vi.fn(async () => 'https://meli.la/new');
    expect(await withMlLinkCache('t1', undefined, URL1, generate, store)).toBe(
      'https://meli.la/new',
    );
    expect(store.data.get(mlAffLinkKey('t1', undefined, URL1))).toBe('https://meli.la/new');
  });

  it('não guarda o link de fallback (matt_word) para não travar o oficial por 24 h', async () => {
    const store = memoryStore();
    const generate = vi.fn(async () => `${URL1}?matt_word=w&matt_tool=1`);
    await withMlLinkCache('t1', undefined, URL1, generate, store);
    expect(store.data.size).toBe(0);
  });

  it('falha do Redis não impede o envio', async () => {
    const broken: LinkStore = {
      get: async () => {
        throw new Error('redis fora');
      },
      set: async () => {
        throw new Error('redis fora');
      },
      del: async () => {},
    };
    expect(
      await withMlLinkCache('t1', undefined, URL1, async () => 'https://meli.la/x', broken),
    ).toBe('https://meli.la/x');
  });

  it('propaga o erro do gerador', async () => {
    await expect(
      withMlLinkCache(
        't1',
        undefined,
        URL1,
        async () => {
          throw new Error('gerador falhou');
        },
        memoryStore(),
      ),
    ).rejects.toThrow('gerador falhou');
  });
});
```

Criar `apps/worker/test/ml-links-prewarm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  ML_AFF_LINK_TTL_SEC,
  MlSessionError,
  mlAffLinkKey,
  mlLinksErrorKey,
} from '@afilados/marketplaces';
import { runMlLinksPrewarm } from '../src/processors/ml-links-prewarm';
import type { LinkStore } from '../src/lib/ml-links';

function memoryStore() {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const store: LinkStore = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v, ttl) => {
      data.set(k, v);
      ttls.set(k, ttl);
    },
    del: async (k) => {
      data.delete(k);
    },
  };
  return { store, data, ttls };
}

const creds = {
  mlSession: { cookies: { ssid: 'abc' }, syncedAt: '2026-10-05T00:00:00Z' },
  tag: 'etq',
};
const U = (n: number) => `https://www.mercadolivre.com.br/p/MLB${n}`;

describe('runMlLinksPrewarm', () => {
  it('sem sessão do ML sincronizada: ignora, sem registrar erro', async () => {
    const { store, data } = memoryStore();
    const generateBatch = vi.fn();
    const r = await runMlLinksPrewarm(
      { loadCredentials: async () => ({}), store, generateBatch },
      { tenantId: 't1', urls: [U(1)] },
    );
    expect(r).toEqual({ skipped: 'sem-sessao' });
    expect(generateBatch).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });

  it('guarda os links no Redis com TTL de 24 h e limpa o erro anterior', async () => {
    const { store, data, ttls } = memoryStore();
    data.set(mlLinksErrorKey('t1'), '{"at":"x"}');
    const generateBatch = vi.fn(async (urls: string[]) => ({
      links: new Map(urls.map((u) => [u, `https://meli.la/${u.slice(-3)}`])),
      failures: [],
    }));
    const r = await runMlLinksPrewarm(
      { loadCredentials: async () => creds, store, generateBatch, sleep: async () => {} },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(r).toMatchObject({ viaBatch: 2, viaFallback: 0 });
    const key = mlAffLinkKey('t1', 'etq', U(1));
    expect(data.get(key)).toBe('https://meli.la/001');
    expect(ttls.get(key)).toBe(ML_AFF_LINK_TTL_SEC);
    expect(data.has(mlLinksErrorKey('t1'))).toBe(false);
    expect(generateBatch.mock.calls[0]?.[0]).toEqual([U(1), U(2)]);
  });

  it('pula as URLs que já estão em cache', async () => {
    const { store, data } = memoryStore();
    data.set(mlAffLinkKey('t1', 'etq', U(1)), 'https://meli.la/ja');
    const generateBatch = vi.fn(async (urls: string[]) => ({
      links: new Map(urls.map((u) => [u, 'https://meli.la/novo'])),
      failures: [],
    }));
    await runMlLinksPrewarm(
      { loadCredentials: async () => creds, store, generateBatch, sleep: async () => {} },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(generateBatch.mock.calls[0]?.[0]).toEqual([U(2)]);
  });

  it('lote falha: usa o método individual e grava o erro para o card', async () => {
    const { store, data } = memoryStore();
    const generateBatch = vi.fn(async () => {
      throw new Error('formato mudou');
    });
    const generateSingle = vi.fn(async (u: string) => `https://meli.la/s${u.slice(-3)}`);
    const r = await runMlLinksPrewarm(
      {
        loadCredentials: async () => creds,
        store,
        generateBatch,
        generateSingle,
        sleep: async () => {},
        now: () => new Date('2026-10-05T17:30:00.000Z'),
      },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(r).toMatchObject({ viaBatch: 0, viaFallback: 2 });
    expect(JSON.parse(data.get(mlLinksErrorKey('t1'))!)).toEqual({
      at: '2026-10-05T17:30:00.000Z',
      message: 'formato mudou',
      urls: 2,
      recoveredByFallback: 2,
    });
    expect(data.get(mlAffLinkKey('t1', 'etq', U(1)))).toBe('https://meli.la/s001');
  });

  it('sessão expirada: registra o erro e não usa o método individual', async () => {
    const { store, data } = memoryStore();
    const generateSingle = vi.fn();
    await runMlLinksPrewarm(
      {
        loadCredentials: async () => creds,
        store,
        generateBatch: async () => {
          throw new MlSessionError('Sessão do Mercado Livre expirou', 'ML_SESSION_EXPIRED');
        },
        generateSingle,
        sleep: async () => {},
      },
      { tenantId: 't1', urls: [U(1)] },
    );
    expect(generateSingle).not.toHaveBeenCalled();
    expect(JSON.parse(data.get(mlLinksErrorKey('t1'))!).message).toMatch(/expirou/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/worker exec vitest run test/ml-link-cache.test.ts test/ml-links-prewarm.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar o cache e o processor**

Criar `apps/worker/src/lib/ml-links.ts`:

```ts
import { ML_AFF_LINK_TTL_SEC, mlAffLinkKey } from '@afilados/marketplaces';
import { getRedis } from './redis';

/** Armazenamento mínimo usado pelo cache de links (Redis em produção, memória nos testes). */
export interface LinkStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function redisLinkStore(): LinkStore {
  const redis = getRedis();
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSec) => {
      if (ttlSec) await redis.set(key, value, 'EX', ttlSec);
      else await redis.set(key, value);
    },
    del: async (key) => {
      await redis.del(key);
    },
  };
}

/**
 * Consulta o cache de links meli.la (preenchido pelo pré-aquecimento) antes de gerar. Só guarda link
 * oficial: o fallback matt_word/matt_tool não deve ficar 24 h impedindo o link oficial de ser usado
 * quando a sessão voltar. Falha do Redis nunca impede o envio.
 */
export async function withMlLinkCache(
  tenantId: string,
  tag: string | undefined,
  url: string,
  generate: () => Promise<string>,
  store: LinkStore = redisLinkStore(),
): Promise<string> {
  const key = mlAffLinkKey(tenantId, tag, url);
  const hit = await store.get(key).catch(() => null);
  if (hit) return hit;
  const link = await generate();
  if (/^https:\/\/meli\.la\//.test(link)) {
    await store.set(key, link, ML_AFF_LINK_TTL_SEC).catch(() => {});
  }
  return link;
}
```

Criar `apps/worker/src/processors/ml-links-prewarm.ts`:

```ts
import type { Job } from 'bullmq';
import pino from 'pino';
import type { MlLinksPrewarmJob, TagCredentials } from '@afilados/shared';
import {
  ML_AFF_LINK_TTL_SEC,
  generateOfficialMlLink,
  generateOfficialMlLinks,
  mlAffLinkKey,
  mlLinksErrorKey,
  prewarmMlAffiliateLinks,
  type BatchLinkResult,
  type PrewarmResult,
} from '@afilados/marketplaces';
import { loadTagCredentials } from '../lib/marketplace-credentials';
import { redisLinkStore, type LinkStore } from '../lib/ml-links';

const log = pino({ name: 'ml-links-prewarm' });

export interface MlLinksPrewarmDeps {
  loadCredentials?: (tenantId: string) => Promise<TagCredentials>;
  store?: LinkStore;
  generateBatch?: (urls: string[]) => Promise<BatchLinkResult>;
  generateSingle?: (url: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/**
 * Gera antecipadamente os links meli.la das URLs pedidas (lote de 20 → individual como fallback) e
 * os guarda no Redis para o envio. Sem sessão do ML sincronizada não há o que fazer (e não é erro).
 */
export async function runMlLinksPrewarm(
  deps: MlLinksPrewarmDeps,
  { tenantId, urls }: MlLinksPrewarmJob,
): Promise<PrewarmResult | { skipped: 'sem-sessao' | 'em-cache' }> {
  const creds = await (deps.loadCredentials ?? ((id) => loadTagCredentials(id, 'MERCADOLIVRE')))(
    tenantId,
  );
  const cookies = creds.mlSession?.cookies;
  if (!cookies || Object.keys(cookies).length === 0) {
    log.info({ tenantId }, 'sem sessão do ML sincronizada; pré-aquecimento ignorado');
    return { skipped: 'sem-sessao' };
  }
  const tag = creds.tag?.trim() || undefined;
  const store = deps.store ?? redisLinkStore();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const pending: string[] = [];
  for (const url of new Set(urls)) {
    if (!(await store.get(mlAffLinkKey(tenantId, tag, url)).catch(() => null))) pending.push(url);
  }
  if (pending.length === 0) return { skipped: 'em-cache' };

  const result = await prewarmMlAffiliateLinks(pending, {
    generateBatch:
      deps.generateBatch ??
      ((batchUrls) => generateOfficialMlLinks(batchUrls, cookies, { tag, pauseMs: 2500 })),
    generateSingle:
      deps.generateSingle ?? ((url) => generateOfficialMlLink(url, cookies, tag ? { tag } : {})),
    store: (url, link) => store.set(mlAffLinkKey(tenantId, tag, url), link, ML_AFF_LINK_TTL_SEC),
    recordError: async (error) => {
      await store.set(mlLinksErrorKey(tenantId), JSON.stringify(error));
      log.warn({ tenantId, ...error }, 'gerador de links em lote falhou');
    },
    clearError: () => store.del(mlLinksErrorKey(tenantId)),
    sleep,
    ...(deps.now ? { now: deps.now } : {}),
  });
  log.info({ tenantId, ...result }, 'pré-aquecimento de links do ML concluído');
  return result;
}

export function createMlLinksPrewarmProcessor(deps: MlLinksPrewarmDeps = {}) {
  return async (job: Job<MlLinksPrewarmJob>) => runMlLinksPrewarm(deps, job.data);
}
```

- [ ] **Step 4: Usar o cache no envio**

Em `apps/worker/src/processors/send-offer.ts`:

1. Adicionar o import: `import { withMlLinkCache } from '../lib/ml-links';`
2. Trocar o `try { affiliateLink = await resolveTagAdapter(product.source).toAffiliateLink(creds, product.originalUrl); }` do bloco final (linhas ~241-245) por:

```ts
      try {
        const generate = () =>
          resolveTagAdapter(product.source).toAffiliateLink(creds, product.originalUrl);
        affiliateLink =
          product.source === 'MERCADOLIVRE'
            ? await withMlLinkCache(
                tenantId,
                creds.tag?.trim() || undefined,
                product.originalUrl,
                generate,
              )
            : await generate();
      } catch (err) {
```

(o `catch` com o `log.warn` que já existe continua igual.)

Em `apps/worker/src/processors/send-telegram.ts`:

1. Adicionar o import: `import { withMlLinkCache } from '../lib/ml-links';`
2. Trocar o `try { affiliateLink = await resolveTagAdapter(product.source).toAffiliateLink(creds, product.originalUrl); }` do bloco final por:

```ts
        try {
          const generate = () =>
            resolveTagAdapter(product.source).toAffiliateLink(creds, product.originalUrl);
          affiliateLink =
            product.source === 'MERCADOLIVRE'
              ? await withMlLinkCache(
                  job.tenantId,
                  creds.tag?.trim() || undefined,
                  product.originalUrl,
                  generate,
                )
              : await generate();
        } catch (err) {
```

(`tenantId` já existe no escopo de `send-offer.ts` (`const tenantId = batch.tenantId;`, linha 83); no Telegram o job traz `job.tenantId`.)

- [ ] **Step 5: Registrar o worker**

Em `apps/worker/src/main.ts`:

1. No import de `@afilados/shared`, adicionar `QUEUE_ML_LINKS_PREWARM,` (ordem alfabética, após `QUEUE_GROUP_LINK_ROTATE`) e `type MlLinksPrewarmJob,` (após `type GroupLinkRotateJob`).
2. Adicionar o import: `import { createMlLinksPrewarmProcessor } from './processors/ml-links-prewarm';`
3. Depois do `groupLinkRotateWorker`:

```ts
// Gera links meli.la em lote (20 por chamada) com pausas; uma execução por vez para não estressar o painel do ML.
const mlLinksPrewarmWorker = new Worker<MlLinksPrewarmJob>(
  QUEUE_ML_LINKS_PREWARM,
  createMlLinksPrewarmProcessor(),
  { connection: getRedis(), concurrency: 1 },
);
```

4. Incluir `mlLinksPrewarmWorker,` na lista do `for (const w of [...])` dos listeners de `failed` e em `Promise.all([...close()])` do `shutdown`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @afilados/worker exec vitest run test/ml-link-cache.test.ts test/ml-links-prewarm.test.ts test/send-offer.test.ts test/send-telegram-custom.test.ts`
Expected: PASS (os testes de envio existentes continuam verdes).

Run: `pnpm --filter @afilados/worker exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/worker/src apps/worker/test/ml-link-cache.test.ts apps/worker/test/ml-links-prewarm.test.ts
git add apps/worker
git commit -m "feat(worker): job ml-links-prewarm e cache de link meli.la no envio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — etiqueta, aviso do lote e subaba "Ofertas do ML"

**Files:**
- Modify: `apps/web/src/lib/types.ts:100-132`
- Modify: `apps/web/src/components/marketplaces/marketplace-config.ts`
- Modify: `apps/web/src/components/marketplaces/marketplace-drawer.tsx`
- Modify: `apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx`
- Modify: `apps/web/src/components/products/search-filters.tsx`
- Modify: `apps/web/src/app/(app)/produtos/page.tsx`
- Test: `apps/web/test/ml-link-warning.test.tsx`, `apps/web/test/marketplace-drawer-ml-tag.test.tsx`, `apps/web/test/produtos-ml-listing.test.tsx` (criar) e `apps/web/test/search-filters.test.tsx` (acrescentar)

**Interfaces:**
- Consumes: `ML_DEAL_CATEGORIES`, `MlListingKind` (Task 1); campos `mlAffiliateTag` e `mlLinkBatchError` do `GET /marketplaces` (Task 7).
- Produces: `MarketplaceConnection.mlAffiliateTag?: string | null` e `mlLinkBatchError?: { at; message; urls; recoveredByFallback } | null`; campo `mlTag` no drawer; `SearchFilters` com `mode="listing"` emitindo `mlListing`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `apps/web/test/search-filters.test.tsx` um novo `describe`:

```tsx
describe('SearchFilters: listagem do Mercado Livre', () => {
  it('Ofertas do dia: emite mlListing deals', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
      sort: 'DISCOUNT_DESC',
      limit: 100,
      topSellers: false,
      extraCommission: false,
      freeShippingOnly: false,
    });
  });

  it('Categoria: só habilita a busca depois de escolher a categoria', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: 'category' } });
    const button = screen.getByRole('button', { name: /buscar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Categoria do ML'), { target: { value: 'MLB1051' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ mlListing: { kind: 'category', categoryId: 'MLB1051' } }),
    );
  });

  it('Colar URL: exige a URL e a envia aparada', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: 'url' } });
    const button = screen.getByRole('button', { name: /buscar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL da listagem'), {
      target: { value: '  https://www.mercadolivre.com.br/mais-vendidos  ' },
    });
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/mais-vendidos' },
      }),
    );
  });

  it('inclui o desconto mínimo junto com a listagem', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), {
      target: { value: 'lightning' },
    });
    fireEvent.change(screen.getByLabelText(/desconto mín/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ mlListing: { kind: 'lightning' }, minDiscountPct: 30 }),
    );
  });
});
```

Criar `apps/web/test/marketplace-drawer-ml-tag.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplaceDrawer } from '@/components/marketplaces/marketplace-drawer';
import type { MarketplaceConnection } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const conn = (over: Partial<MarketplaceConnection> = {}) =>
  ({
    kind: 'MERCADOLIVRE',
    status: 'OK',
    affiliateTag: 'w',
    mattWord: 'w',
    mattTool: '1',
    hasMlApi: false,
    mlApiAvailable: false,
    mlSessionSyncedAt: null,
    mlSessionSource: null,
    ...over,
  }) as MarketplaceConnection;

function renderDrawer(connection: MarketplaceConnection, onSubmit = vi.fn(async () => {})) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MarketplaceDrawer
        kind="MERCADOLIVRE"
        connection={connection}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
        feedback={null}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe('MarketplaceDrawer: etiqueta do ML', () => {
  it('mostra a etiqueta salva e envia a nova', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: 'minha-tag' }));
    const input = screen.getByLabelText(/etiqueta de afiliado/i) as HTMLInputElement;
    expect(input.value).toBe('minha-tag');
    fireEvent.change(input, { target: { value: 'outra' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ mlTag: 'outra' }) }),
    );
  });

  it('esvaziar a etiqueta salva envia mlTag vazio para limpar', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: 'minha-tag' }));
    fireEvent.change(screen.getByLabelText(/etiqueta de afiliado/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ mlTag: '' }) }),
    );
  });

  it('sem etiqueta salva e campo vazio, não envia mlTag', () => {
    const onSubmit = renderDrawer(conn({ mlAffiliateTag: null }));
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));
    const payload = (onSubmit.mock.calls[0] as unknown as [{ fields: Record<string, string> }])[0];
    expect(payload.fields).not.toHaveProperty('mlTag');
  });
});
```

Criar `apps/web/test/ml-link-warning.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplacesClient } from '@/app/(app)/marketplaces/marketplaces-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const base = { status: 'OK', affiliateTag: null, lastError: null, lastCheckedAt: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketplacesClient />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetchMock.mockReset());

describe('aviso do gerador de links em lote', () => {
  it('mostra o erro e quantos links foram salvos pelo método individual', async () => {
    apiFetchMock.mockResolvedValue([
      { ...base, kind: 'SHOPEE' },
      {
        ...base,
        kind: 'MERCADOLIVRE',
        mlLinkBatchError: {
          at: '2026-10-05T17:30:00.000Z',
          message: 'Gerador de links do ML respondeu HTTP 500',
          urls: 5,
          recoveredByFallback: 3,
        },
      },
    ]);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Gerador de links em lote falhou/);
    expect(alert.textContent).toMatch(/Gerador de links do ML respondeu HTTP 500/);
    expect(alert.textContent).toMatch(/3 de 5/);
  });

  it('não mostra aviso quando não há erro', async () => {
    apiFetchMock.mockResolvedValue([{ ...base, kind: 'MERCADOLIVRE', mlLinkBatchError: null }]);
    renderPage();
    await screen.findByText('Mercado Livre');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
```

Criar `apps/web/test/produtos-ml-listing.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProdutosPage from '@/app/(app)/produtos/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ useRealtime: () => {} }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/marketplaces') return [{ kind: 'MERCADOLIVRE', hasMlApi: false }];
    if (path === '/queue') return { items: [], limit: 100, count: 0 };
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProdutosPage />
    </QueryClientProvider>,
  );
}

describe('Buscar Produtos: Ofertas do ML', () => {
  it('a subaba só existe para o Mercado Livre', () => {
    renderPage();
    expect(screen.queryByText('Ofertas do ML')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByRole('button', { name: 'Ofertas do ML' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(screen.queryByText('Ofertas do ML')).toBeNull();
  });

  it('ao escolher o ML sem a API oficial, abre direto em Ofertas do ML', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByLabelText('Fonte da listagem')).toBeTruthy();
  });

  it('busca chama /products/search com mlListing', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/marketplaces') return [{ kind: 'MERCADOLIVRE', hasMlApi: false }];
      if (path === '/queue') return { items: [], limit: 100, count: 0 };
      if (path === '/products/search') return { products: [] };
      throw new Error(`unexpected call: ${path}`);
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }));
    await vi.waitFor(() => {
      const call = apiFetchMock.mock.calls.find(([p]) => p === '/products/search');
      expect(call).toBeTruthy();
      expect((call?.[1] as { json: unknown }).json).toMatchObject({
        source: 'MERCADOLIVRE',
        mode: 'listing',
        mlListing: { kind: 'deals' },
      });
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/search-filters.test.tsx test/marketplace-drawer-ml-tag.test.tsx test/ml-link-warning.test.tsx test/produtos-ml-listing.test.tsx`
Expected: FAIL (campos/UI inexistentes).

- [ ] **Step 3: Tipos e campo da etiqueta**

Em `apps/web/src/lib/types.ts`, na interface `MarketplaceConnection`, após `mattTool: string | null;`:

```ts
  /** Etiqueta de afiliado do ML usada no gerador meli.la (vazio = padrão da conta). */
  mlAffiliateTag?: string | null;
```

e antes de `lastCheckedAt: string | null;`:

```ts
  /** Último erro do gerador de links em lote do ML (só no card do ML); some quando um lote volta a funcionar. */
  mlLinkBatchError?: {
    at: string;
    message: string;
    urls: number;
    recoveredByFallback: number;
  } | null;
```

Em `apps/web/src/components/marketplaces/marketplace-config.ts`:

1. Adicionar `| 'mlTag'` ao final do union `MarketplaceFieldKey` (após `'trackingId'`).
2. No array `fields` do `MERCADOLIVRE`, após o campo `mattTool`:

```ts
      {
        key: 'mlTag',
        label: 'Etiqueta de afiliado (opcional)',
        type: 'text',
        required: false,
        placeholder: 'Ex: minha-etiqueta',
        helpTitle: 'Onde encontro minha etiqueta?',
        helpContent:
          'Na Central de afiliados do Mercado Livre → "Administrar etiquetas". Deixe em branco para usar a etiqueta padrão da conta.',
      },
```

Em `apps/web/src/components/marketplaces/marketplace-drawer.tsx`:

1. Em `initialFieldValue`, adicionar o caso (junto dos de `mattTool`):

```ts
    case 'mlTag':
      return connection?.mlAffiliateTag ?? '';
```

2. No `handleSubmit`, trocar o laço de coleta dos campos por:

```ts
    for (const field of config.fields) {
      const value = values[field.key]?.trim();
      if (!value) {
        // esvaziar a etiqueta que já estava salva limpa-a (volta à etiqueta padrão da conta)
        if (field.key === 'mlTag' && initialFieldValue('mlTag', connection) !== '') {
          fields.mlTag = '';
        }
        continue;
      }
      fields[field.key] = value;
    }
```

- [ ] **Step 4: Aviso no card do ML**

Em `apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx`:

1. Import: `import { formatDateTime } from '@/lib/format';`
2. Dentro do card (`<div key={kind} ...>`), logo após `<p className="mb-4 text-sm text-muted-foreground">{config.description}</p>`:

```tsx
              {kind === 'MERCADOLIVRE' && conn?.mlLinkBatchError && (
                <p
                  role="alert"
                  className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600"
                >
                  Gerador de links em lote falhou em {formatDateTime(conn.mlLinkBatchError.at)}:{' '}
                  {conn.mlLinkBatchError.message}. {conn.mlLinkBatchError.recoveredByFallback} de{' '}
                  {conn.mlLinkBatchError.urls} link(s) foram gerados pelo método individual.
                </p>
              )}
```

- [ ] **Step 5: Formulário do modo `listing`**

Em `apps/web/src/components/products/search-filters.tsx`:

1. Import: adicionar `ML_DEAL_CATEGORIES` e `type MlListingKind` ao import de `@afilados/shared`.
2. Estado, após `const [freeShippingOnly, setFreeShippingOnly] = useState(false);`:

```tsx
  const [listingKind, setListingKind] = useState<MlListingKind>('deals');
  const [listingCategory, setListingCategory] = useState('');
  const [listingUrl, setListingUrl] = useState('');
```

3. Em `submit`, após `if (mode === 'category') raw.categoryId = categoryId;`:

```tsx
    if (mode === 'listing') {
      raw.mlListing =
        listingKind === 'category'
          ? { kind: 'category', categoryId: listingCategory }
          : listingKind === 'url'
            ? { kind: 'url', url: listingUrl.trim() }
            : { kind: listingKind };
    }
```

4. No JSX, após o bloco `{mode === 'trending' && (...)}` e antes do `<Button type="submit"`:

```tsx
        {mode === 'listing' && (
          <div className="flex flex-1 flex-wrap gap-2">
            <select
              aria-label="Fonte da listagem"
              value={listingKind}
              onChange={(e) => setListingKind(e.target.value as MlListingKind)}
              className={`${selectCls} w-56`}
            >
              <option value="deals">Ofertas do dia</option>
              <option value="category">Ofertas por categoria</option>
              <option value="lightning">Ofertas relâmpago</option>
              <option value="url">Colar URL de listagem</option>
            </select>
            {listingKind === 'category' && (
              <select
                aria-label="Categoria do ML"
                value={listingCategory}
                onChange={(e) => setListingCategory(e.target.value)}
                className={`${selectCls} w-64`}
              >
                <option value="">Selecione uma categoria</option>
                {ML_DEAL_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            {listingKind === 'url' && (
              <Input
                aria-label="URL da listagem"
                value={listingUrl}
                onChange={(e) => setListingUrl(e.target.value)}
                placeholder="https://www.mercadolivre.com.br/ofertas?…"
                className="min-w-64 flex-1"
              />
            )}
          </div>
        )}
```

5. Trocar o `disabled` do botão Buscar por:

```tsx
          disabled={
            loading ||
            (!supportsAdvancedModes && mode !== 'keyword' && mode !== 'listing') ||
            (mode === 'category' && !categoryId) ||
            (mode === 'listing' &&
              ((listingKind === 'category' && !listingCategory) ||
                (listingKind === 'url' && !listingUrl.trim())))
          }
```

6. No fim da `div` de filtros (depois do bloco que mostra "só busca por palavra-chave está disponível"), antes do `</div>` de fechamento:

```tsx
        {mode === 'listing' && (
          <p className="basis-full text-xs text-muted-foreground">
            A ordem é a da página do Mercado Livre. O preço mostrado pode ser o do Pix (veja a nota
            no produto).
          </p>
        )}
```

- [ ] **Step 6: Subaba na página de produtos**

Em `apps/web/src/app/(app)/produtos/page.tsx`:

1. Em `ALL_SUBTABS`, entre `shop` e `import`:

```ts
  { key: 'listing', label: 'Ofertas do ML', sources: ['MERCADOLIVRE'] },
```

2. Substituir `const effectiveSub = isKeywordDisabled && sub === 'keyword' ? 'import' : sub;` por:

```ts
  // Sem busca por palavra-chave (anti-bot), o ML abre nas Ofertas do ML; os demais, em Por Links / CSV.
  const fallbackSub = (kind: MarketplaceKind): SearchMode | 'import' =>
    kind === 'MERCADOLIVRE' ? 'listing' : 'import';
  const effectiveSub: SearchMode | 'import' =
    isKeywordDisabled && sub === 'keyword' ? fallbackSub(source) : sub;
```

3. Em `selectSource`, trocar `setSub('import'); return;` do primeiro `if` por `setSub(fallbackSub(kind)); return;` e, no fim, `setSub(willDisableKeyword ? 'import' : 'keyword');` por `setSub(willDisableKeyword ? fallbackSub(kind) : 'keyword');`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/web exec vitest run`
Expected: PASS em toda a suíte do web (inclusive `marketplace-drawer`, `marketplaces-page` e `search-filters` existentes).

Run: `pnpm --filter @afilados/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write apps/web/src apps/web/test
git add apps/web
git commit -m "feat(web): subaba Ofertas do ML, etiqueta de afiliado e aviso do gerador em lote

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verificação final e validação no Docker

**Files:**
- Modify: nenhum (só verificação); se algo falhar, corrigir na task de origem.

- [ ] **Step 1: Suíte completa, tipos e formatação**

```bash
docker compose up -d --wait postgres redis
pnpm test
pnpm typecheck
pnpm lint
```

Expected: todos os testes passam, `typecheck` sem erros, `lint` (prettier --check) sem arquivos fora do padrão. Se o `lint` apontar arquivos, rodar `pnpm exec prettier --write <arquivos>` e commitar `style: formatação`.

- [ ] **Step 2: Subir tudo no Docker**

```bash
docker compose up -d --build --wait
docker compose ps
```

Expected: `api`, `worker`, `web`, `postgres` e `redis` em `running`/`healthy`.

```bash
docker compose logs worker --tail 40
```

Expected: linha `worker iniciado` e nenhum erro de importação (o worker novo `ml-links-prewarm` sobe junto).

- [ ] **Step 3: Conferir a busca por listagem pela tela (as quatro fontes)**

No painel (`http://localhost:3000`, login do seed): **Buscar Produtos → Mercado Livre → Ofertas do ML**. Para cada fonte, clicar em **Buscar** e anotar o resultado:

1. **Ofertas do dia** (Qtd. 50): vêm produtos com preço, preço riscado e "% OFF"; nenhum com título "Importando…".
2. **Ofertas por categoria** (ex.: Celulares e Telefones): os produtos são da categoria escolhida.
3. **Ofertas relâmpago**: produtos com data de término (visível no card do produto ou em `raw`).
4. **Colar URL de listagem** com `https://www.mercadolivre.com.br/mais-vendidos`: devolve produtos; com `https://evil.com/x` aparece erro de validação ("Use um link https do Mercado Livre").

Conferir também: **Desconto mín. 40** filtra de verdade (todos os resultados com 40% ou mais) e **Qtd. 100** pagina (mais de 48 resultados, em até 5 páginas, levando uns segundos).

Se alguma busca retornar "O Mercado Livre bloqueou a listagem…", sincronizar a sessão pela extensão Afilados Connect (ou colar o cookie no drawer do ML) e repetir; isso valida o fallback com cookies. Se aparecer "mudou de layout", abrir `docker compose logs api --tail 30` e copiar o `details` do log para ajustar o parser (Task 2) com a nova fixture.

- [ ] **Step 4: Conferir os links em lote**

Com a sessão do ML sincronizada e a etiqueta (opcional) preenchida no drawer do ML ("Etiqueta de afiliado"):

1. Selecionar ~25 produtos da busca e clicar em **Salvar selecionados**.
2. Em seguida:

```bash
docker compose logs worker --since 3m | grep -i "ml-links-prewarm\|pré-aquecimento\|gerador de links"
```

Expected: `pré-aquecimento de links do ML concluído` com `viaBatch` próximo da quantidade salva. (O gerador em lote usa um endpoint interno do ML não documentado: se `viaBatch` for 0 e `viaFallback` for a quantidade toda, o formato da resposta em lote é diferente do esperado; os links ainda saem, pelo método individual, e o card do ML mostra o aviso.)

3. Conferir no Redis que há links guardados:

```bash
docker compose exec redis redis-cli --scan --pattern "ml-aff-link:*" | head -3
docker compose exec redis redis-cli ttl "$(docker compose exec redis redis-cli --scan --pattern 'ml-aff-link:*' | head -1 | tr -d '\r')"
```

Expected: chaves `ml-aff-link:<tenant>:<tag|default>:<sha1>` e TTL entre 80000 e 86400.

- [ ] **Step 5: Conferir o aviso do card (erro do método 1)**

Os dois métodos usam o mesmo endpoint, então o erro é simulado gravando a chave à mão:

```bash
TENANT=$(docker compose exec -T postgres psql -U afilados -d afilados -tAc 'select id from "Tenant" limit 1' | tr -d '\r')
docker compose exec redis redis-cli set "ml-links-batch:last-error:$TENANT" '{"at":"2026-10-05T17:30:00.000Z","message":"Gerador de links do ML respondeu HTTP 500","urls":5,"recoveredByFallback":3}'
```

Abrir **Marketplaces**: o card do Mercado Livre mostra o aviso amarelo "Gerador de links em lote falhou em … 3 de 5 link(s) foram gerados pelo método individual." Depois remover:

```bash
docker compose exec redis redis-cli del "ml-links-batch:last-error:$TENANT"
```

Recarregar **Marketplaces**: o aviso some.

- [ ] **Step 6: Conferir o envio**

Levar 1–2 produtos do ML para um lote e deixar o worker enviar (ou usar "Enviar a seguir"): a mensagem sai com o link `https://meli.la/…` (do cache) e, nos logs do worker, não aparece `falha ao gerar link de afiliado`.

```bash
docker compose logs worker --since 5m | grep -i "falha ao gerar link"
```

Expected: nenhuma linha.

- [ ] **Step 7: Registrar e finalizar**

Atualizar a memória do projeto (`afilados-project-context.md` ou nova nota `ml-ofertas-listagem.md`) com: busca do ML por listagem em vez de palavra-chave, links em lote com fallback e o servidor de produção ser uma máquina Linux interna (IP residencial). Depois:

```bash
git status --short
git log --oneline -12
```

Expected: árvore limpa; commits das Tasks 1–9 no branch `feat/ml-ofertas-listagem`. Em seguida usar a skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Auto-revisão do plano (feita contra a spec)

- **Seção 1 (listagens):** `buildMlListingUrl` (4 fontes, SSRF), parser `poly-card` + carrossel, `period_end`, `priceNote`, `cleanMlProductUrl` com `#wid`, `isMlVerificationPage`, `fetchMlListing` (5 páginas, 1–2 s, cookies de fallback, `BLOCKED`/`LAYOUT`/`INVALID_URL`/`HTTP`, página 2+ tolerante, `filter`) → Tasks 2–3. Categorias estáticas verificadas → Task 1. Schema `listing` → Task 1. Rota e mapeamento de erros → Task 6. Subaba e formulário → Task 9.
- **Seção 2 (links em lote):** `generateOfficialMlLinks` (20 por lote, um CSRF, `tag`) → Task 4. Etiqueta no drawer/PUT/`publicConnection` → Tasks 7 e 9. Cache Redis 24 h com chave por tenant/etiqueta/sha1 → Tasks 5 e 8. Pré-aquecimento ao salvar na fila e ao trazer para lote → Tasks 7 e 8. Fallback método 1 → 2 sem acionar em sessão expirada → Task 5. Erro gravado e aviso no card → Tasks 5, 7, 8 e 9.
- **Seção 3 (testes/validação):** fixtures reais (Task 2), testes de lote/fallback/erros/cache em cada camada, validação no Docker (Task 10).
- **Consistência de nomes:** `fetchMlListing`, `MlListingSource`, `MlListingError`, `generateOfficialMlLinks`, `BatchLinkResult`, `prewarmMlAffiliateLinks`, `PrewarmDeps`, `mlAffLinkKey`, `mlLinksErrorKey`, `MlLinkBatchError`, `withMlLinkCache`, `LinkStore`, `QUEUE_ML_LINKS_PREWARM`, `MlLinksPrewarmJob`, `mlTag`, `mlAffiliateTag`, `mlLinkBatchError` usados com a mesma grafia em todas as tasks.
