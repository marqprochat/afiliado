# Sistema de cupons (busca automática, manual, validação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-25-sistema-cupons-design.md` (leia antes de começar —
tabela de APIs em §1, trade-offs de validação em §4, decisões em aberto no final).

**Goal:** a "Central de Cupons" deixa de ser placeholder. Cupons passam a ter origem
(`MANUAL | API | EXTENSION | IMPORT | MIRROR`), status (`UNVERIFIED | VALID | INVALID | EXPIRED`)
e histórico de verificação. Um job periódico puxa cupons reais da **Awin (Offers API)** e da
**AliExpress (`promo_code_info` dos produtos)**. O usuário cadastra cupons manualmente ou cola
um texto livre que é parseado. A validação cobre expiração/sumiço na fonte (automática), o
botão "Funcionou / Não funcionou" (manual) e um painel da extensão no carrinho da loja
(assistida).

**Architecture:** o schema ganha campos em `Coupon` e o model novo `CouponCheck`. O pacote
`@afilados/core` recebe o parser puro de texto (`parseCouponsFromText`). O
`@afilados/marketplaces` ganha fontes de cupom (`fetchAliexpressPromoCodes`,
`listAwinVouchers`) com mappers puros para `CouponUpsertInput`. O worker ganha a fila
`coupon-sync` (processor + scheduler no padrão `awin-import`). A API ganha `routes/coupons.ts`
e rotas `/extension/coupons*`. O web substitui o placeholder por uma página de lista com
diálogos. A extensão corrige a captura e ganha o painel no carrinho.

**Tech Stack:** Prisma/Postgres, BullMQ/Redis, Fastify + Zod, Next.js/React/TanStack Query,
extensão Chrome MV3 (JS puro), Vitest.

## Global Constraints

- **Nada de checkout automatizado no servidor** (nível 3 do spec §4) — fora de escopo.
- O auto-clique em "aplicar cupom" na extensão (nível 2) fica **atrás de um flag por loja,
  desligado por padrão**, até o usuário decidir (decisão em aberto nº 1). O padrão entregue é
  o nível 2b: copiar o código, destacar o campo e perguntar "funcionou?".
- O sync **nunca rebaixa** um status definido por verificação humana (`VALID`/`INVALID`). Só a
  expiração por data sobrepõe.
- AliExpress é amostragem: cupom ausente numa rodada **não** expira. Awin (listagem `active`
  exaustiva): cupom ausente numa rodada bem-sucedida expira.
- Código de cupom é normalizado com `trim().toUpperCase()` em todo ponto de entrada.
- Unicidade: `(tenantId, store, code, scope)`, com `scope = advertiser.id` na Awin e `''` nas
  demais.
- Antes de dar qualquer task como concluída: rebuild e subida no Docker e validação lá
  (`docker compose build ... && docker compose up -d ...`).
- A Task 11 (colheita dos grupos espelhados) **só é executada com aprovação explícita do
  usuário**.

---

## Task 0: Spike de verificação ao vivo (sem código de produção)

Objetivo: confirmar as premissas do spec antes de codar. Os resultados vão numa seção
"Apêndice — resultados do spike" no final do spec.

- [ ] **AliExpress:** com as credenciais reais do tenant (carregar via
  `loadAliexpressCredentials`), rodar um script descartável no scratchpad que chama
  `aliexpress.affiliate.hotproduct.query` (`target_currency=BRL`, `target_language=PT`,
  `ship_to_country=BR`, `page_size=50`, páginas 1–3) e conta quantos produtos vêm com
  `promo_code_info.promo_code` preenchido. Testar com e sem `fields=...,promo_code_info`.
  Registrar o formato exato de `code_availabletime_end` (fuso), de `code_value` e de
  `code_mini_spend`.
  **Go/no-go:** se vier 0 código em 150 produtos nas duas variações, a fonte AliExpress da
  Task 4 continua sendo implementada (é barata), mas o spec deve registrar a baixa cobertura.
- [ ] **Awin:** pedir ao usuário o Publisher ID e um token gerado em `ui.awin.com/awin-api`
  (decisão em aberto nº 3). Chamar `POST https://api.awin.com/publisher/{id}/promotions` com
  `{"filters":{"membership":"joined","type":"voucher","regionCodes":["BR"],"status":"active"},"pagination":{"page":1,"pageSize":200}}`
  e registrar o formato real da resposta (nome do array, `voucher.code`, `urlTracking`,
  `endDate`, rate limit nos headers). Sem token: implementar a parte Awin da Task 4 só com fixture e
  marcar a fonte como "aguardando credencial".
- [ ] **Shopee:** abrir o explorer da Open API (`open-api.affiliate.shopee.com.br/explorer`)
  e confirmar que não existe query de voucher. Se existir, parar e avisar o Planejador.
- [ ] **Seletores de carrinho:** com o usuário logado no Chrome (Claude-in-Chrome ou portal
  Maestri), abrir o carrinho/checkout de AliExpress, Amazon BR, Magalu e Mercado Livre com um
  item e anotar: seletor do campo de cupom, do botão aplicar, da mensagem de sucesso e da
  mensagem de erro, e a URL (padrão) da página onde o campo existe. **Não aplicar cupom
  nenhum** nesta etapa, só inspecionar o DOM.

Sem commit de código. Commit só do apêndice no spec:
`docs(cupons): resultados do spike de APIs e seletores`.

---

## Task 1: DB — schema de cupons e `CouponCheck`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Coupon` ~linha 478; relação `checks`
  em `Tenant`)
- Create: `packages/db/prisma/migrations/20260925120000_coupon_system/migration.sql`
- Modify: `packages/db/test/automation-schema.test.ts` (ou criar
  `packages/db/test/coupon-schema.test.ts`)

**Interfaces:**
- Produces: enums `CouponOrigin`, `CouponStatus`, `CouponDiscountType`, `CouponCheckMethod`;
  campos novos em `Coupon`; model `CouponCheck`; unique composto
  `tenantId_store_code_scope`. Consumido pelas Tasks 2–11.

- [ ] **Step 1:** Aplicar no `schema.prisma` exatamente o bloco do spec §5 e adicionar
  `couponChecks CouponCheck[]` no model `Tenant`.
- [ ] **Step 2:** Gerar o SQL com
  `pnpm --filter @afilados/db exec prisma migrate dev --create-only --name coupon_system`,
  renomear a pasta para `20260925120000_coupon_system` e **revisar à mão**. O SQL precisa:
  1. criar os 4 enums;
  2. `ALTER TABLE "Coupon" ADD COLUMN "scope" TEXT NOT NULL DEFAULT ''`, `"origin" ... DEFAULT 'MANUAL'`,
     `"status" ... DEFAULT 'UNVERIFIED'`, `"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
     e as colunas opcionais;
  3. `DROP INDEX "Coupon_tenantId_store_code_key"` e
     `CREATE UNIQUE INDEX "Coupon_tenantId_store_code_scope_key" ON "Coupon"("tenantId","store","code","scope")`;
  4. criar o índice `(tenantId, status, expiresAt)` e a tabela `CouponCheck` com as FKs em
     cascata.
- [ ] **Step 3:** Teste de schema (falhando antes de migrar): criar um cupom só com os campos
  antigos → `origin=MANUAL`, `status=UNVERIFIED`, `scope=''`. Dois cupons com o mesmo code e
  store mas `scope` diferente → ok. Mesmo `scope` → erro `P2002`. Apagar o cupom apaga os
  `CouponCheck`.
- [ ] **Step 4:** `pnpm --filter @afilados/db exec prisma migrate deploy && pnpm --filter @afilados/db run generate`
  e rodar o teste do Step 3 → passa.
- [ ] **Step 5:** Buscar usos de `tenantId_store_code` no repo
  (`grep -rn "tenantId_store_code" apps packages`) e atualizar para
  `tenantId_store_code_scope` (com `scope: ''`). Typecheck: `pnpm -r typecheck`.
- [ ] **Step 6:** Commit `feat(db): origem, status e histórico de verificação de cupons`.

---

## Task 2: Shared — schemas Zod, fila e evento

**Files:**
- Create: `packages/shared/src/coupon.ts` (exportar no `index.ts`)
- Modify: `packages/shared/src/queues.ts`, `packages/shared/src/events.ts`,
  `packages/shared/src/enums.ts` (se os enums de domínio ficam lá — seguir o padrão de
  `MARKETPLACE_KINDS`)
- Create: `packages/shared/test/coupon.test.ts`

**Interfaces (produces):**

```typescript
export const COUPON_ORIGINS = ['MANUAL', 'API', 'EXTENSION', 'IMPORT', 'MIRROR'] as const;
export const COUPON_STATUSES = ['UNVERIFIED', 'VALID', 'INVALID', 'EXPIRED'] as const;
export const COUPON_DISCOUNT_TYPES = ['PERCENT', 'FIXED', 'FREE_SHIPPING'] as const;

const code = z.string().trim().min(3).max(40).transform((s) => s.toUpperCase());

export const couponInputSchema = z.object({
  store: z.enum(MARKETPLACE_KINDS),
  advertiserName: z.string().max(120).nullish(),
  code,
  description: z.string().trim().min(1).max(500),
  terms: z.string().max(2000).nullish(),
  discountType: z.enum(COUPON_DISCOUNT_TYPES).nullish(),
  discountValue: z.number().positive().nullish(),
  minSpend: z.number().nonnegative().nullish(),
  startsAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
  sourceUrl: z.string().url().nullish(),
});
export type CouponInput = z.infer<typeof couponInputSchema>;

export const couponListQuerySchema = z.object({
  store: z.enum(MARKETPLACE_KINDS).optional(),
  status: z.enum(COUPON_STATUSES).optional(),
  origin: z.enum(COUPON_ORIGINS).optional(),
  q: z.string().max(100).optional(),
  includeExpired: z.coerce.boolean().optional(),
});
export const couponVerifySchema = z.object({
  result: z.enum(['VALID', 'INVALID']),
  note: z.string().max(500).optional(),
});
export const couponParseSchema = z.object({
  text: z.string().min(1).max(20_000),
  store: z.enum(MARKETPLACE_KINDS).optional(),
});
export const couponBulkSchema = z.object({ coupons: z.array(couponInputSchema).min(1).max(200) });
```

Em `queues.ts`: `QUEUE_COUPON_SYNC = 'coupon-sync'` e
`interface CouponSyncJob { tenantId: string; trigger: 'schedule' | 'manual' }`.
Em `events.ts`: `| { type: 'coupons.updated' }`.

- [ ] **Step 1:** Testes (falhando): `code` normaliza `"  bemvindo10 "` → `"BEMVINDO10"`;
  `code` curto (<3) rejeita; `couponVerifySchema` rejeita `EXPIRED`; o
  `includeExpired=true` em query string vira boolean.
- [ ] **Step 2:** Implementar. **Step 3:** testes passam + `pnpm --filter @afilados/shared typecheck`.
- [ ] **Step 4:** Commit `feat(shared): schemas, fila e evento de cupons`.

---

## Task 3: Core — parser de texto e elegibilidade por status

**Files:**
- Create: `packages/core/src/coupon-parse.ts` (exportar no `index.ts`)
- Modify: `packages/core/src/eligibility.ts`
- Create: `packages/core/test/coupon-parse.test.ts`; modify o teste de elegibilidade existente

**Interfaces (produces):**

```typescript
export interface CouponCandidate {
  store: MarketplaceKind | null;   // null = não detectada; a UI obriga escolher
  code: string;                    // já normalizado
  description: string;             // linha(s) de contexto em volta do código
  discountType: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
  discountValue: number | null;
  minSpend: number | null;
  expiresAt: string | null;        // ISO, fim do dia America/Sao_Paulo
  sourceUrl: string | null;        // primeira URL do bloco
}
export function parseCouponsFromText(text: string, opts?: { defaultStore?: MarketplaceKind; now?: Date }): CouponCandidate[];
```

Regras do parser (determinístico, sem LLM):
1. Quebra o texto em **blocos** (linhas em branco ou separadores `—`, `•••`, `➖`) — cada bloco
   de grupo de cupons costuma ser uma oferta.
2. **Código:** padrões `cupom|cupon|c[óo]digo|code|use|voucher` seguidos de `:`/espaço/emoji e
   um token `[A-Z0-9][A-Z0-9_-]{2,39}`; também um token todo em maiúsculas entre crases, aspas
   ou `*negrito*` numa linha que contém "cupom". Descartar a stoplist (`OFF`, `FRETE`, `GRATIS`,
   `PIX`, `BLACK`, `HOJE`, números puros, tokens que aparecem dentro de URL).
3. **Loja:** pelo domínio de URL no bloco (reusar os detectores de `packages/core/src/urls.ts`
   / `links.ts` se já mapeiam host → `MarketplaceKind`) ou por palavra-chave (`amazon`,
   `mercado livre|mercadolivre|meli`, `magalu|magazine luiza`, `shopee`, `aliexpress|ali`).
   Se nada bater, usa `defaultStore` ou `null`.
4. **Desconto:** `(\d+)\s*%\s*(off|de desconto)?` → PERCENT; `R\$\s*([\d.,]+)\s*(off|de desconto)` → FIXED;
   `frete gr[áa]tis` → FREE_SHIPPING. **Mínimo:** `(acima de|em compras? (a partir )?de|m[íi]nimo( de)?)\s*R\$\s*([\d.,]+)`
   (reusar o parse de BRL de `money.ts`).
5. **Validade:** `(v[áa]lido|at[ée]|expira)\s*(em\s*)?(\d{1,2})/(\d{1,2})(/\d{2,4})?` (ano
   ausente = ano de `now`, ou o seguinte se a data já passou), `hoje` → fim do dia de `now`.
6. Dedup por `(store, code)` dentro da mesma chamada.

`isEligibleCoupon` ganha `status?: CouponStatus`: `INVALID` → `{ ok:false, reason:'invalid' }`,
`EXPIRED` → `reason:'expired'`.

- [ ] **Step 1:** Escrever os testes com **pelo menos 8 mensagens reais** de grupos de
  cupons (pedir exemplos ao usuário ou usar formatos típicos: "🔥 CUPOM: BEMVINDO10 — 10% OFF
  na Shopee", "Amazon: use o código *PRIMEIRA20* e ganhe R$ 20 OFF acima de R$ 100. Válido até
  30/09", mensagem com 3 lojas, mensagem com URL `mercadolivre.com.br/...`, falso positivo
  "BLACK FRIDAY 50% OFF" sem código → 0 candidatos).
- [ ] **Step 2:** Implementar e iterar até passar. `cd packages/core && npx vitest run`.
- [ ] **Step 3:** Teste e implementação do `isEligibleCoupon` com status.
- [ ] **Step 4:** Commit `feat(core): parser de cupons em texto livre e elegibilidade por status`.

---

## Task 4: Marketplaces — fontes de cupom (AliExpress + Awin)

**Files:**
- Create: `packages/marketplaces/src/coupons.ts` (tipo comum)
- Create: `packages/marketplaces/src/aliexpress/coupons.ts`
- Create: `packages/marketplaces/src/awin/offers.ts`
- Modify: `packages/marketplaces/src/adapter.ts` (`AwinCredentials` + `publisherId?`,
  `offersApiToken?`), `packages/marketplaces/src/index.ts`
- Create: fixtures `packages/marketplaces/src/aliexpress/fixtures/promo-code-products.json`,
  `packages/marketplaces/src/awin/fixtures/promotions.json` (do spike; se não houver, montar a
  partir da doc do spec §1)
- Tests: `packages/marketplaces/test/aliexpress-coupons.test.ts`, `awin-offers.test.ts`

**Interfaces (produces):**

```typescript
// coupons.ts
export interface CouponUpsertInput {
  store: MarketplaceKind;
  scope: string;                 // '' ou advertiser.id
  advertiserName: string | null;
  code: string;                  // normalizado
  description: string;
  terms: string | null;
  discountType: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
  discountValue: number | null;
  minSpend: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  sourceUrl: string | null;
  affiliateUrl: string | null;
  externalId: string | null;
  remainingUses: number | null;
}

// aliexpress/coupons.ts
export function mapPromoCodeInfo(product: any): CouponUpsertInput | null;
export async function fetchAliexpressPromoCodes(
  creds: AliexpressCredentials,
  opts?: { keywords?: string[]; maxPages?: number; pageSize?: number; client?: AliexpressClient },
): Promise<CouponUpsertInput[]>;   // dedup por code, mantém o de maior validade

// awin/offers.ts
export async function listAwinVouchers(
  creds: Required<Pick<AwinCredentials, 'publisherId' | 'offersApiToken'>>,
  opts?: { fetchImpl?: typeof fetch; regionCodes?: string[] },
): Promise<CouponUpsertInput[]>;   // pagina até esgotar; lança AwinApiError('AWIN_UNAUTHORIZED') em 401/403
export function mapAwinPromotion(p: any): CouponUpsertInput | null; // null se voucher.code vazio
```

Mapeamentos:
- `promo_code_info`: `code_campaigntype` `'1'` → FIXED, `'2'` → PERCENT. O valor numérico sai
  do `code_value` por regex. `description = code_value`. `minSpend = Number(code_mini_spend)`.
  As datas `code_availabletime_*` são convertidas com o fuso confirmado no spike.
  `affiliateUrl = code_promotionurl`, `sourceUrl = product_detail_url`,
  `externalId = String(product_id)`, `remainingUses = Number(code_quantity)`.
  `scope = ''` e `store = 'ALIEXPRESS'`.
- Awin: `store='AWIN'`, `scope=String(advertiser.id)`, `advertiserName=advertiser.name`,
  `code=voucher.code`, `description=title`, `terms=[description, terms].filter(Boolean).join('\n')`,
  `startsAt/expiresAt` de `startDate/endDate`, `sourceUrl=url`,
  `affiliateUrl=urlTracking ?? null`, `externalId=String(promotionId)`.

- [ ] **Step 1:** Testes dos mappers com as fixtures (tipo 1 e 2, `promo_code` vazio → null,
  `voucher.code` null → null, datas).
- [ ] **Step 2:** Teste do `listAwinVouchers` com `fetchImpl` mockado: 2 páginas, filtros no
  body, header `Authorization: Bearer`, 401 → `AWIN_UNAUTHORIZED`.
- [ ] **Step 3:** Teste do `fetchAliexpressPromoCodes` com um client fake: para em `maxPages`
  e deduplica.
- [ ] **Step 4:** Implementar. Reusar `AliexpressClient.execute` e **não** duplicar a
  assinatura. Seguir o estilo do `awin/datafeed.ts` para erros.
- [ ] **Step 5:** `cd packages/marketplaces && npx vitest run` + typecheck.
- [ ] **Step 6:** Commit `feat(marketplaces): fontes de cupons AliExpress (promo_code_info) e Awin (Offers API)`.

---

## Task 5: Worker — `coupon-sync` (processor + scheduler)

**Files:**
- Create: `apps/worker/src/processors/coupon-sync.ts`
- Create: `apps/worker/src/automation/coupon-sync-scheduler.ts`
- Create: `apps/worker/src/lib/coupon-upsert.ts` (função compartilhada de upsert, reaproveitada
  na Task 11)
- Modify: `apps/worker/src/lib/queue-helpers.ts` (`enqueueCouponSync`),
  `apps/worker/src/lib/marketplace-credentials.ts` (Awin devolve os campos novos),
  `apps/worker/src/main.ts` (worker + scheduler + `for (const w of [...])`)
- Modify: `apps/worker/src/automation/scheduler.ts:207` — passar
  `status: candidate.coupon.status` para `isEligibleCoupon`
- Tests: `apps/worker/test/coupon-sync.test.ts`, `apps/worker/test/coupon-sync-scheduler.test.ts`

**Interfaces:**

```typescript
// lib/coupon-upsert.ts
export async function upsertCoupon(
  tenantId: string,
  input: CouponUpsertInput,
  origin: 'API' | 'EXTENSION' | 'MIRROR',
  now: Date,
): Promise<'created' | 'updated'>;
// - create: status UNVERIFIED (ou EXPIRED se expiresAt < now), lastSeenAt=now
// - update: só metadados + lastSeenAt; NÃO toca em status, exceto:
//   expiresAt < now -> EXPIRED + CouponCheck(EXPIRY);
//   remainingUses === 0 -> INVALID + CouponCheck(SOURCE, 'esgotado') se ainda não INVALID
// - NÃO altera `origin` de cupom existente (um MANUAL continua MANUAL mesmo se a API o trouxer)

// processors/coupon-sync.ts
export interface CouponSyncResult { source: 'ALIEXPRESS' | 'AWIN' | 'EXPIRY'; ok: boolean; created: number; updated: number; expired: number; error?: string }
export function createCouponSyncProcessor(deps?: {
  fetchAliexpressPromoCodes?: typeof fetchAliexpressPromoCodes;
  listAwinVouchers?: typeof listAwinVouchers;
  now?: () => Date;
}): (job: Job<CouponSyncJob>) => Promise<CouponSyncResult[]>;
```

Fluxo do processor (por tenant):
1. `runStartedAt = now()`.
2. **AliExpress** (se houver credencial): keywords = união das `keywords` das
   `AutomationRule` do tenant que incluem `ALIEXPRESS` (no máximo 5, sorteadas). Chama
   `fetchAliexpressPromoCodes` e faz upsert de cada item com `origin=API`. Erro →
   `{ ok:false, error }`, e as demais fontes seguem.
3. **Awin** (se `publisherId` e `offersApiToken`): chama `listAwinVouchers` e faz upsert. **Só
   se ok:** os cupons `store=AWIN, origin=API, status NOT IN (EXPIRED)` com
   `lastSeenAt < runStartedAt` viram `EXPIRED` + `CouponCheck(SOURCE, 'não está mais ativo na Awin')`.
4. **Varredura de expiração:** os cupons do tenant com `expiresAt < now` e
   `status != EXPIRED` viram `EXPIRED` + `CouponCheck(EXPIRY)` (`updateMany` + `createMany`
   dos checks numa transação).
5. `publishEvent(tenantId, { type: 'coupons.updated' })` (usar o helper de
   `apps/worker/src/lib/events.ts`).

Scheduler: copiar a estrutura do `AwinImportScheduler` (tick inicial, env
`COUPON_SYNC_INTERVAL_HOURS` com default 6 e o mesmo guard contra NaN/≤0). O tick seleciona os
tenants com `marketplaceConnection` `ALIEXPRESS` ou `AWIN` e `encryptedCredentials` não nulo.
jobId: `coupon-sync-${tenantId}-${hourBucket}`, para não empilhar duplicados.

- [ ] **Step 1:** Testes do `upsertCoupon`: cria; atualiza sem rebaixar `VALID`; expira por
  data; `remainingUses=0` vira `INVALID`; não troca origin de um `MANUAL`.
- [ ] **Step 2:** Testes do processor: expira o Awin ausente; **não** expira o AliExpress
  ausente; falha da Awin não impede o AliExpress nem a varredura; a varredura cria
  `CouponCheck(EXPIRY)`; o evento é publicado.
- [ ] **Step 3:** Teste do scheduler (intervalo inválido → default; enfileira um job por
  tenant elegível) no molde de `awin-import-scheduler.test.ts`.
- [ ] **Step 4:** Implementar + ajustar o `scheduler.ts` (status na elegibilidade), com um
  teste em `automation-scheduler.test.ts`: cupom `INVALID` na fila → `SKIPPED` com o motivo
  `invalid`.
- [ ] **Step 5:** `cd apps/worker && npx vitest run test/coupon-sync.test.ts test/coupon-sync-scheduler.test.ts test/automation-scheduler.test.ts`
  (as 2 falhas pré-existentes do `automation-scheduler` são conhecidas) + typecheck.
- [ ] **Step 6:** Commit `feat(worker): sincronização periódica de cupons e varredura de expiração`.

---

## Task 6: API — CRUD, parse, bulk, sync e verificação

**Files:**
- Create: `apps/api/src/routes/coupons.ts`, `apps/api/src/lib/coupons.ts` (serialização:
  `Decimal` → number, como em `lib/products.ts`)
- Modify: `apps/api/src/app.ts` (registrar `couponsRoutes`),
  `apps/api/src/lib/marketplaces.ts` (`loadAwinCredentials` com os campos novos)
- Create: `apps/api/test/coupons.test.ts`

Rotas: a tabela do spec §6 (primeira tabela). Detalhes:
- `GET /coupons`: `where` montado a partir de `couponListQuerySchema`. `q` faz `contains`
  insensitive em `code`, `description` e `advertiserName`. Sem `includeExpired`, filtra
  `status != EXPIRED`. Ordena em memória por
  `STATUS_ORDER = { VALID:0, UNVERIFIED:1, INVALID:2, EXPIRED:3 }` e depois por `expiresAt`
  asc (nulos por último). Limite de 500.
- `POST /coupons`: `create` com `origin: 'MANUAL'`; captura `P2002` →
  `new ApiError('CONFLICT', 'Cupom já cadastrado para esta loja', 409)` (conferir se o
  `ApiError` tem `conflict()`; senão usar o construtor). Publica `coupons.updated`.
- `PUT /coupons/:id`: `updateMany({ where:{id}, data })` + `findFirst`, no padrão de
  `templates.ts`. 404 se não achar.
- `DELETE /coupons/:id`: `batchItem.count({ where:{ couponId:id } }) > 0` → 409.
- `POST /coupons/parse`: `parseCouponsFromText(text, { defaultStore: store })`. Marca
  `exists: boolean` em cada candidato consultando os cupons existentes do tenant (a UI mostra
  "já cadastrado").
- `POST /coupons/bulk`: `createMany({ skipDuplicates: true })` com `origin: 'IMPORT'` →
  `{ created: count, skipped: n - count }`.
- `POST /coupons/sync`: igual a `/marketplaces/awin/import` (`getQueue(QUEUE_COUPON_SYNC)`,
  `waitUntilFinished(getQueueEvents(...), 45_000)`, fallback `{ queued: true }`). Sem
  AliExpress nem Awin-offers configurados → 400 "Nenhuma fonte automática configurada
  (AliExpress ou Awin com token de ofertas)".
- `POST /coupons/:id/verify`: numa transação, `couponCheck.create({ method:'MANUAL', result, note })`
  + `coupon.updateMany({ status: result, lastVerifiedAt: now })`.
- `GET /coupons/:id/checks`: os últimos 50, desc.

- [ ] **Step 1:** Testes (usar `helpers.ts` existente; ver `automations.test.ts` para
  criação de tenant/sessão): isolamento de tenant em todas as rotas; 409 no duplicado; `PUT`
  não altera status; `DELETE` 409 com `BatchItem`; `verify` cria o check e muda o status;
  `parse` não grava e marca `exists`; `bulk` pula duplicados; `sync` sem fonte → 400; o `GET`
  esconde `EXPIRED` por padrão e ordena por status.
- [ ] **Step 2:** Implementar. **Step 3:** `cd apps/api && npx vitest run test/coupons.test.ts` + typecheck.
- [ ] **Step 4:** Commit `feat(api): CRUD, importação por texto, sync e verificação de cupons`.

---

## Task 7: API — rotas da extensão para cupons

**Files:**
- Modify: `apps/api/src/routes/extension.ts`
- Modify: `apps/api/test/extension-and-tokens.test.ts`

- `GET /extension/coupons?store=` → os cupons da loja com `status IN (VALID, UNVERIFIED)`,
  mais `id, code, description, minSpend, expiresAt, status, lastVerifiedAt`.
- `POST /extension/coupons` `{ store, code, description?, sourceUrl? }` → upsert com
  `origin=EXTENSION`, sem rebaixar status (mesma regra do `upsertCoupon` do worker; se
  precisar compartilhar, mover a lógica pura "calcular o data de update" para
  `@afilados/core` ou duplicar o mínimo com comentário).
- `POST /extension/coupons/:id/verification` `{ result: 'VALID'|'INVALID', note? }` →
  igual ao `verify`, com `method: 'EXTENSION'`.
- `POST /extension/capture`: se `body.couponCode` vier e não for um placeholder genérico,
  também faz upsert em `Coupon` (`store` = marketplace do produto, `sourceUrl` = URL do
  produto, `description` = "Visto em: {título do produto}").

- [ ] **Step 1:** Testes: auth por token obrigatória; o `GET` filtra por loja e status;
  capture com `couponCode` cria o `Coupon` `EXTENSION`; capture repetida não duplica e não
  rebaixa `VALID`; verification grava o check `EXTENSION`.
- [ ] **Step 2:** Implementar. **Step 3:** vitest + typecheck.
- [ ] **Step 4:** Commit `feat(api): endpoints de cupons para a extensão`.

---

## Task 8: Web — página "Central de Cupons"

**Files:**
- Modify: `apps/web/src/app/(app)/config/cupons/page.tsx` (substitui o placeholder)
- Create: `apps/web/src/components/coupons/coupon-list.tsx`, `coupon-form-dialog.tsx`,
  `coupon-import-dialog.tsx`, `coupon-status-badge.tsx`, `coupon-checks-popover.tsx`
- Modify: `apps/web/src/lib/types.ts` (`Coupon`, `CouponCheck`, `CouponCandidate`),
  `apps/web/src/lib/queries.ts` (`useCoupons(filters)`, `useCouponChecks(id)`),
  `apps/web/src/lib/realtime.tsx` (`coupons.updated` → invalida `['coupons']`)
- Tests: `apps/web/test/coupons-page.test.tsx`

Layout (seguir os componentes de `components/ui` e o estilo de `config/templates/page.tsx`):
- **Cabeçalho:** título "Central de Cupons", botões **Buscar cupons agora** (chama
  `POST /coupons/sync` e mostra um toast com o resumo por fonte), **Colar texto** e
  **Novo cupom**.
- **Filtros:** Loja, Status, Origem, busca por texto e o checkbox "Mostrar expirados".
- **Lista (cards responsivos, sem overflow horizontal):** código em fonte mono com botão de
  copiar; loja (+ anunciante); descrição; chips de desconto/mínimo/validade ("expira em 2
  dias" em destaque quando faltar menos de 3 dias); badge de status + "verificado há X"; badge
  de origem. Ações: **Funcionou** / **Não funcionou** (abre um mini-form de nota opcional →
  `POST /coupons/:id/verify`), **Abrir loja** (`affiliateUrl ?? sourceUrl`, nova aba),
  **Histórico** (popover com `GET /coupons/:id/checks`), **Editar**, **Excluir** (com
  confirmação na UI — não usar `window.confirm`; seguir o padrão de diálogo existente) e
  **Enviar para automação** (select da regra → `POST /automations/:id/queue/coupon` com
  `couponId`, endpoint que já existe).
- **Diálogo novo/editar:** os campos da tabela do spec §3.
- **Diálogo colar texto:** textarea + select "Loja padrão" → "Analisar" → tabela de
  candidatos editável (checkbox, loja obrigatória quando `null`, código, descrição, desconto,
  validade; linhas `exists` desmarcadas com a tag "já cadastrado") → "Salvar selecionados" →
  `POST /coupons/bulk`.
- **Estado vazio:** explica as fontes ("Configure AliExpress ou Awin (token de ofertas) para
  busca automática, ou cadastre/cole cupons").

- [ ] **Step 1:** Testes de componente: renderiza a lista com badges; o filtro de status
  refaz a query; "Funcionou" chama o verify com `VALID`; fluxo colar → analisar → salvar
  envia só os marcados; expirados escondidos por padrão.
- [ ] **Step 2:** Implementar. **Step 3:** `cd apps/web && npx vitest run test/coupons-page.test.tsx` + `pnpm --filter @afilados/web typecheck`.
- [ ] **Step 4:** Commit `feat(web): Central de Cupons com cadastro, importação por texto e validação`.

---

## Task 9: Web — credenciais de Ofertas da Awin

**Files:**
- Modify: `apps/web/src/components/marketplaces/marketplace-config.ts`,
  `marketplace-drawer.tsx` (seção Awin)
- Modify: o schema/rota de salvar credenciais Awin na API (`apps/api/src/routes/marketplaces.ts`
  + o schema em `packages/shared`) para aceitar `publisherId` e `offersApiToken` opcionais,
  sem quebrar o salvamento só com `feedListUrl`
- Tests: os testes existentes de marketplaces (API) + o teste do drawer, se existir

- [ ] **Step 1:** Adicionar dois campos opcionais na seção Awin: "Publisher ID" e "Token da
  API (Ofertas/Cupons)", com um texto de ajuda que aponta para `ui.awin.com/awin-api`. O
  token nunca volta preenchido do servidor (mostrar "•••• configurado").
- [ ] **Step 2:** `checkConnection` da Awin: se o token vier, fazer uma chamada de
  `listAwinVouchers` com `pageSize=10` para validar; 401 → erro "Token de ofertas da Awin
  inválido". O datafeed segue validado como hoje.
- [ ] **Step 3:** Testes: salvar sem token continua funcionando; salvar com token inválido →
  erro claro.
- [ ] **Step 4:** Commit `feat(awin): credenciais da Offers API para sincronizar cupons`.

---

## Task 10: Extensão — captura correta e painel de cupons no carrinho

**Files:**
- Modify: `apps/extension/content/content.js` (captura ~linhas 116–185; painel novo)
- Create: `apps/extension/content/coupon-stores.js` (mapa de seletores por loja, do spike)
- Modify: `apps/extension/background/background.js` (chamadas `/extension/coupons*` com o token
  já usado), `apps/extension/manifest.json` (content script também nas URLs de
  carrinho/checkout, se ainda não cobertas), `apps/extension/content/content.css`

**Parte A — captura:**
- Remover o valor fixo `'CUPOM AMAZON'`. Na Amazon, o cupom de clipar vira só `couponValue`
  (extrair "R$ X" ou "X%" do `#couponText`/`.couponBadge`) e não gera `couponCode`.
- Trocar a regex global do `document.body.innerText` por uma busca restrita aos containers de
  preço/promoção de cada loja (seletores em `coupon-stores.js`), mantendo a regex só como
  fallback, com a mesma stoplist do parser da Task 3.
- Quando achar um código real, além de mandar no capture, chamar `POST /extension/coupons`.

**Parte B — painel no carrinho (nível 2b por padrão):**
- `coupon-stores.js` exporta, por loja:
  `{ match: RegExp /* URL do carrinho/checkout */, input: string, apply: string, success: string[], error: string[], autoApply: false }`.
- Numa página que casa com `match`: busca `GET /extension/coupons?store=`. Se houver cupons,
  injeta um painel flutuante recolhível "Cupons Afilados (N)". Cada linha mostra o código, a
  descrição, o mínimo e a validade, com os botões:
  - **Copiar e destacar**: copia o código, faz `scrollIntoView` + outline no `input`. Depois
    aparecem **Funcionou** / **Não funcionou** → `POST /extension/coupons/:id/verification`.
  - **Testar automaticamente**: só renderiza se `autoApply === true` para a loja (desligado
    em todas por padrão; decisão em aberto nº 1). Preenche o input (setter nativo +
    `input`/`change` events), clica em `apply` e observa por até 8s com `MutationObserver` os
    seletores `success`/`error`. **Pré-marca** o resultado e **exige o clique de confirmação**
    do usuário antes de enviar. Um cupom por clique, nunca em lote.
- Loja sem entrada em `coupon-stores.js`, ou seletor que não casa: o painel mostra só a lista
  com o botão Copiar e os botões manuais. Nunca quebra a página.

- [ ] **Step 1:** Preencher `coupon-stores.js` com os seletores do spike (Task 0) para
  AliExpress, Amazon BR, Magalu e ML.
- [ ] **Step 2:** Implementar as Partes A e B e rodar `node apps/extension/build.js`.
- [ ] **Step 3:** Teste manual assistido pelo usuário (com o usuário logado): carregar a
  extensão de `dist/`, abrir a página de produto com cupom → cupom aparece na Central com a
  origem Extensão; abrir o carrinho → painel lista os cupons; "Copiar e destacar" +
  "Funcionou" → status VALID na Central com o histórico `EXTENSION`.
- [ ] **Step 4:** Commit `feat(extension): captura real de cupons e painel de validação no carrinho`.

---

## Task 11 (OPCIONAL — só com aprovação do usuário): colheita nos grupos espelhados

**Files:**
- Modify: `apps/worker/src/processors/mirror-message.ts` (ou o listener em `apps/worker/src/mirror/`)
- Modify: model/config de `MirrorRule` **somente se** o usuário quiser liga/desliga por regra
  (senão, flag global em `Settings`)
- Test: `apps/worker/test/mirror-message.test.ts`

- [ ] Depois de processar a mensagem (sem alterar o fluxo de espelhamento), extrair o texto
  (caption/conversation), rodar `parseCouponsFromText` e fazer `upsertCoupon(..., 'MIRROR')`
  para os candidatos com `store !== null`. Falha do parser/upsert **nunca** derruba o
  espelhamento (try/catch + log). Teste: mensagem com cupom cria `Coupon` `MIRROR`; erro no
  upsert não impede o envio espelhado.
- [ ] Commit `feat(mirror): coleta cupons das mensagens dos grupos de origem`.

---

## Verificação final

- [ ] Suíte completa (as falhas pré-existentes conhecidas são 2 no
  `automation-scheduler.test.ts`, além das de `wa.test.ts`/`batch-form.test.tsx`):

```bash
cd /d/apps/afilados
DATABASE_URL="postgresql://afilados:afilados@localhost:5434/afilados" pnpm -r test 2>&1 | tail -120
pnpm -r typecheck
```

- [ ] Rebuild e subida no Docker (**obrigatório antes de concluir**):

```bash
docker compose build api worker web && docker compose up -d api worker web
docker compose logs --tail=100 worker | grep -i coupon
```

- [ ] Fluxo end-to-end no ambiente Docker:
  1. A Central de Cupons abre sem placeholder; "Novo cupom" cria; um duplicado mostra o erro
     de conflito.
  2. "Colar texto" com uma mensagem de grupo real → candidatos corretos → salvar.
  3. "Buscar cupons agora" → toast com o resumo por fonte (AliExpress e, se houver token,
     Awin); cupons `API` aparecem.
  4. "Não funcionou" num cupom → `INVALID`. Enfileirá-lo numa automação → o scheduler marca
     `SKIPPED` com o motivo `invalid`.
  5. Criar um cupom com validade de ontem → depois do sync, aparece como `EXPIRED` (com
     "Mostrar expirados" marcado) e o histórico mostra `EXPIRY`.
  6. Extensão: captura + painel do carrinho conforme a Task 10, Step 3.
