# Plano — Atribuição de vendas Awin por grupo + página Vendas

Spec: `docs/superpowers/specs/2026-11-25-awin-atribuicao-vendas-design.md`.
Branch: `feat/awin-atribuicao-vendas`. TDD em cada tarefa (teste falhando → código → verde).
Testes com Postgres/Redis rodam no servidor (`.superpowers/sdd/remote.sh run ...`).

## Tarefa 1 — Schema, migração e helpers do banco (`packages/db`)
- `prisma/schema.prisma`: `trackCode String?` + `@@unique([tenantId, trackCode])` em `WaGroup` e
  `TelegramChat`; modelos `OfferClick` e `AffiliateSale`; enums `AffiliateNetwork`,
  `AffiliateSaleStatus`, `SaleChannelKind`, `AffiliateSaleSource`.
- `prisma/migrations/20261125120000_awin_sales_attribution/migration.sql` (SQL à mão no formato
  do Prisma; conferido no servidor com `prisma migrate deploy` + `prisma migrate diff`).
- `src/track-code.ts`: `generateTrackCode(kind)` + `ensureTrackCode(db, channel)` (lazy, retry em P2002).
- `src/affiliate-sales.ts`: `resolveChannelByTrackCode`, `upsertAffiliateSale` (idempotente em
  `(tenantId, network, externalId)`; não apaga canal já resolvido).
- `src/index.ts`: exporta e inclui `OfferClick`/`AffiliateSale` em `TENANT_MODELS`.
- Testes: `test/track-code.test.ts` (unitário, db falso), `test/affiliate-sales.test.ts` (Postgres).

## Tarefa 2 — Tipos compartilhados (`packages/shared`)
- `src/queues.ts`: `QUEUE_AWIN_SALES_SYNC`, `AwinSalesSyncJob`; `SendTelegramJob.batchId?`.
- `src/sales.ts`: `AWIN_WEBHOOK_TOKEN_KEY`, `salesQuerySchema` (from/to ISO opcionais, padrão 30 dias,
  status, page), tipos `SalesSummary`, `SalesList`, `AwinWebhookInfo`.
- Testes: `test/sales.test.ts`.

## Tarefa 3 — Helpers puros de link (`packages/marketplaces`, `packages/core`)
- `marketplaces/src/awin/channel-refs.ts`: `withAwinChannelRefs(url, { channel, batch })`.
- `core/src/channel-link.ts`: `sanitizeTrackParam` (alfanumérico ≤ 32), `withSiteChannelParams`.
- Testes: `marketplaces/test/awin-channel-refs.test.ts`, `core/test/channel-link.test.ts`.

## Tarefa 4 — Cliente de transações Awin (`packages/marketplaces`)
- `src/awin/transactions.ts`: `mapAwinTransaction` (tolerante: aninhado/achatado), 
  `parseAwinWebhookBody`, `listAwinTransactions` (URL, Bearer, janela ≤ 31 dias, 401/403 →
  `AWIN_UNAUTHORIZED`).
- `src/awin/fixtures/transactions.json`.
- Testes: `test/awin-transactions.test.ts`.

## Tarefa 5 — Link por canal no envio (`apps/worker`)
- `src/lib/channel-link.ts`: `channelizeLink` (site → `?c=&b=`; Awin direto → clickref2/3; demais
  iguais) e `swapLinkInMessage` (troca só o link na mensagem já renderizada).
- `send-offer.ts`: mensagem por grupo (render único, troca de link por grupo, `ensureTrackCode`
  do `WaGroup`); `batchId` vai no job do Telegram.
- `send-telegram.ts`: mesma regra por chat (`TelegramChat.trackCode`).
- Testes: `test/channel-link.test.ts` (unitário), casos novos em `test/send-offer.test.ts` e
  `test/send-telegram-site-links.test.ts` (Postgres).

## Tarefa 6 — Sincronização de vendas (`apps/worker`)
- `src/processors/awin-sales-sync.ts` (só tenant raiz com `publisherId` + token; upsert; reaproveita
  `AWIN_TOKEN_ERROR`).
- `src/automation/awin-sales-sync-scheduler.ts` (hora em hora: janela 7 dias; 1×/dia: 31 dias;
  jobId deduplicado por hora/dia) + `lib/queue-helpers.ts` + `main.ts`.
- Testes: `test/awin-sales-sync.test.ts` (Postgres), `test/awin-sales-sync-scheduler.test.ts`.

## Tarefa 7 — API pública: redirecionamento e webhook (`apps/api`)
- `src/routes/offer-redirect.ts`: `GET /r/:listingId?c=&b=` (rate limit, grava `OfferClick` sem
  bloquear, 302 com refs Awin); `src/lib/offer-clicks.ts`.
- `src/routes/awin-webhook.ts`: `POST /webhooks/awin/:token` (timingSafeEqual, 404/400, JSON e
  form-urlencoded).
- `deals.ts`: exporta `resolvePublicTenantId`.
- Testes: `test/offer-redirect.test.ts`, `test/awin-webhook.test.ts`.

## Tarefa 8 — API autenticada de vendas (`apps/api`)
- `src/routes/sales.ts`: `GET /sales/summary`, `GET /sales`, `GET /sales/awin-webhook`,
  `POST /sales/awin-webhook/rotate`; `src/lib/sales/summary.ts` (agregações em memória).
- Testes: `test/sales.test.ts`.

## Tarefa 9 — Web (`apps/web`)
- `(app)/vendas/page.tsx`, `components/sales/vendas-client.tsx`, `lib/sales-queries.ts`.
- Sidebar: item "Vendas".
- `ofertas/[slug]/page.tsx` e `components/deals/deal-card.tsx`: botão comprar → `/api/v1/r/<id>`
  repassando `c`/`b` (`lib/offer-redirect.ts`).
- Testes: `test/vendas-page.test.tsx`, `test/offer-redirect.test.ts`, ajuste em
  `test/oferta-detail-page.test.tsx`.

## Verificação
- Local: `npx vitest run --root <pkg> <padrão>` (testes sem banco) e `npx tsc --noEmit -p .` em
  db, shared, marketplaces, core, api, worker, web.
- Servidor: `prisma migrate deploy`, testes com Postgres de db/api/worker e suíte web.
- Commits lógicos em português, sem os três arquivos alheios (`ofertas/page.tsx`, landing nav/footer).
