# Fase 1 — Núcleo de Disparo

**Data:** 2026-09-14
**Status:** Aprovado
**Depende de:** `2026-09-14-afilados-architecture-design.md`

## 1. Resultado esperado ao final da F1

O dono do projeto consegue, no VPS dele:

1. Fazer login no painel (usuário criado por seed).
2. Conectar um número de WhatsApp por QR code ou pair code; a sessão sobrevive a restart do worker.
3. Ver a lista de grupos/comunidades/canais do número, com indicação de onde o bot é admin.
4. Conectar a Shopee Open Platform (App Key/Secret + tag de afiliado) e ver o status da conexão.
5. Buscar produtos na Shopee por palavra-chave, categoria, mais buscados e loja, com filtros de ordenação, tipo, quantidade, Top Vendedores e Comissão Extra.
6. Importar produtos por lista de links ou CSV.
7. Salvar produtos na fila de triagem (limite configurável, padrão 500), selecionar/desmarcar, remover.
8. Editar o template da mensagem com variáveis e ver preview ao vivo.
9. Criar um lote: nome, grupos-alvo, intervalo em minutos, embaralhar, formato Imagem ou Preview; ver previsão de término.
10. Acompanhar o envio em tempo real (status por item), com o bot respeitando a janela de operação.
11. Ver na Visão Geral: status WA/Shopee, itens na fila, lotes em andamento, últimos erros.

Fora da F1: espelhamento, ML/Amazon/Magalu, cupons, selos na imagem, CTAs por IA, moderação, analytics, billing.

## 2. Estrutura do monorepo criada nesta fase

```
apps/api, apps/worker, apps/web
packages/db, packages/core, packages/marketplaces, packages/shared
docker-compose.yml, docker-compose.prod.yml, deploy.sh, .env.example
```

Ferramentas: pnpm 9, Turborepo, TypeScript 5 strict, ESLint + Prettier, Vitest, Husky (lint + test em pre-commit).

## 3. Banco de dados (Prisma) — tabelas da F1

Tabelas de fases futuras (`Plan`, `Subscription`, `MirrorRule`, `Coupon`, etc.) são criadas já na F1 com o schema mínimo definido no spec de arquitetura, para que as migrations futuras sejam aditivas. Aqui só o que a F1 usa de fato:

```prisma
model Tenant   { id, name, createdAt; users, ... }
model User     { id, tenantId, email @unique, passwordHash, name, role: OWNER|MEMBER }
model Session  { id, userId, expiresAt }                       // Lucia

model WaSession {
  id, tenantId, label, phone?, status: DISCONNECTED|CONNECTING|NEEDS_QR|CONNECTED|LOGGED_OUT
  authCreds Json?, lastQr String?, pairCode String?, lastSeenAt
}
model WaAuthKey { sessionId, type, keyId, value Json  @@id([sessionId,type,keyId]) } // signal keys
model WaGroup {
  id, tenantId, sessionId, jid @unique(sessionId), name, kind: GROUP|COMMUNITY|CHANNEL
  botIsAdmin Boolean, memberCount Int, inviteLink?, syncedAt
}

model MarketplaceConnection {
  id, tenantId, kind: SHOPEE|MERCADOLIVRE|AMAZON|MAGALU
  encryptedCredentials Bytes, affiliateTag String?, status: UNCONFIGURED|OK|ERROR, lastCheckedAt, lastError
  @@unique([tenantId, kind])
}

model Product {
  id, tenantId, source: SHOPEE|MERCADOLIVRE|AMAZON|MAGALU|MANUAL, externalId?
  title, price Decimal, originalPrice Decimal?, discountPct Int?, salesCount Int?, commissionPct Decimal?
  images String[], shipping: NONE|FREE|FULL|UNKNOWN, flashSaleEndsAt?, couponCode?, couponValue Decimal?
  originalUrl, shopId?, shopName?, raw Json, createdAt
  @@unique([tenantId, source, externalId])
}
model QueueItem { id, tenantId, productId, selected Boolean, status: PENDING|SENT|ERROR, addedAt  @@unique([tenantId, productId]) }

model Template  { id, tenantId, name, body, isDefault }
model OperatingWindow { tenantId @id, startTime "07:30", endTime "23:30", timezone "America/Sao_Paulo", enabled }

model Batch {
  id, tenantId, sessionId, name, groupJids String[], intervalMin Int, mediaMode: IMAGE|PREVIEW
  shuffled Boolean, templateId, status: SCHEDULED|RUNNING|PAUSED|DONE|CANCELLED, estimatedEndAt, createdAt
}
model BatchItem { id, batchId, productId, order Int, runAt, status: PENDING|SENDING|SENT|ERROR, error?  @@unique([batchId, productId]) }
model SendLog   { id, tenantId, batchItemId?, groupJid, waMessageId?, status: SENT|ERROR, error?, sentAt  @@unique([batchItemId, groupJid]) }
model Setting   { tenantId, key, value Json  @@id([tenantId,key]) }   // queueLimit, globalRateLimit, subIdPattern
```

## 4. API (Fastify) — rotas da F1

Todas sob `/api/v1`, autenticadas exceto `auth/*`. Payloads validados com Zod de `packages/shared`.

| Método | Rota | Função |
|---|---|---|
| POST | `auth/login`, `auth/logout` | sessão em cookie |
| GET | `me` | usuário + tenant + settings |
| GET/PUT | `settings` | janela de operação, limite de fila, rate limit, padrão de SubID |
| GET | `wa/sessions` · POST `wa/sessions` · DELETE `wa/sessions/:id` | gerir sessões |
| POST | `wa/sessions/:id/connect` (`{mode: 'qr'|'pair', phone?}`) · `.../disconnect` · `.../logout` | fluxo de conexão; QR chega via WS |
| POST | `wa/sessions/:id/sync-groups` · GET `wa/sessions/:id/groups` | lista grupos com `botIsAdmin` |
| GET/PUT | `marketplaces/:kind` · POST `marketplaces/:kind/check` | credenciais + status |
| POST | `products/search` | `{source:'shopee', mode:'keyword'|'category'|'trending'|'shop', query, categoryId?, shopId?, sort, type, limit, topSellers, extraCommission}` |
| POST | `products/import` | `{urls: string[]}` ou CSV (multipart, colunas `url`, `titulo?`) |
| GET/POST/DELETE | `queue` · `queue/select` · `queue/:id` | fila de triagem |
| GET/POST/PUT/DELETE | `templates` · POST `templates/preview` | CRUD + render com produto de exemplo |
| GET/POST | `batches` · GET `batches/:id` · POST `batches/:id/pause|resume|cancel` | lotes |
| GET | `overview` | dados da Visão Geral |
| WS | `/ws` | eventos: `wa.qr`, `wa.status`, `wa.groups.synced`, `batch.progress`, `batch.item`, `error` |

Erros: JSON `{error: {code, message}}`; códigos estáveis (`WA_NOT_CONNECTED`, `QUEUE_FULL`, `SHOPEE_UNCONFIGURED`, ...).

## 5. Worker

### 5.1 WaSessionManager
- Na inicialização: carrega `WaSession` com status ≠ `LOGGED_OUT`, tenta adquirir lock Redis `wa:lock:{id}` (TTL 30s, renovado a cada 10s); sem lock, ignora.
- Auth state em Postgres: `authCreds` em `WaSession`, chaves Signal em `WaAuthKey` (implementação de `AuthenticationState` do Baileys com escrita em lote).
- Eventos: `connection.update` → atualiza status, publica `wa.qr`/`wa.status`; em `loggedOut` limpa creds e marca `LOGGED_OUT`; outros fechamentos → reconecta com backoff 2s→60s.
- Pair code: `requestPairingCode(phone)` após socket abrir sem creds.
- `sync-groups`: `groupFetchAllParticipating()` + canais via `newsletter*`; calcula `botIsAdmin` comparando o jid do bot com `participants[].admin`.
- Comandos da API chegam por fila `wa-commands` (connect/disconnect/logout/sync).

### 5.2 Processor `send-offer`
Input: `{batchItemId}`. Passos:
1. Carrega item, batch, produto, template, conexão Shopee. Se batch `PAUSED|CANCELLED`, sai.
2. Se fora da janela → reagenda para `nextWindowOpen` e recalcula `estimatedEndAt`.
3. `toAffiliateLink` (Shopee: `generateShortLink` da Open Platform com `subId` gerado pelo padrão configurado, ex. `{yyyyMMdd}-{batchId}`).
4. `renderTemplate`.
5. Para cada `groupJid` do batch: se já existe `SendLog` com `waMessageId`, pula; senão envia:
   - `IMAGE`: `sendMessage(jid, {image: {url}, caption})`
   - `PREVIEW`: `sendMessage(jid, {text, linkPreview: {title, description, thumbnail}})` — thumbnail baixada e reduzida (≤ 100 KB) para caber no preview.
   - jitter ±15% aplicado entre grupos; respeita teto global por sessão (Redis token bucket).
6. Grava `SendLog`, atualiza `BatchItem`, `QueueItem.status`, publica `batch.item`; ao último item, `Batch.status = DONE`.
Retry BullMQ: 3 tentativas, backoff exponencial; erro final → `BatchItem.ERROR`.

### 5.3 Agendamento do lote
`core.scheduleBatch(items, intervalMin, window, now)` devolve `runAt[]`: primeiro item em `now` (ou próxima abertura), seguintes a cada `intervalMin`, pulando o período fechado. `estimatedEndAt = runAt[last]`. A API cria um job por item com `delay = runAt - now` e `jobId = batchItemId` (idempotente). Pause remove jobs pendentes; resume recalcula e re-enfileira.

## 6. Adapter Shopee (`packages/marketplaces/shopee`)

Baseado na Shopee Affiliate Open Platform (GraphQL, autenticação `SHA256(appId+timestamp+payload+secret)`):
- `checkConnection` — chamada leve autenticada.
- `search` — `productOfferV2` com `keyword | productCatId | shopId | listType(trending)`, `sortType` (desconto, comissão, vendas, preço asc/desc), filtros `isOfficialShop`/`isKeySeller` (Top Vendedores), `hasExtraCommission`. Paginação até `limit`.
- `fetchByUrls` — extrai `shopId/itemId` da URL e busca `productOfferV2` por `itemId`.
- `toAffiliateLink` — `generateShortLink(originUrl, subIds[])`.
- Modo mock (`SHOPEE_MOCK=1`): devolve fixtures para desenvolvimento sem credenciais.

Os nomes exatos de campos são verificados contra a documentação oficial durante a implementação e fixados nos testes de fixture.

## 7. `packages/core` — funções da F1 e regras

- `renderTemplate(body, product, ctx)`: placeholders de §6 do spec de arquitetura; `{cupom}` e `{oferta_relampago}` renderizam vazio na F1 quando o produto não tiver dado; blocos `{#var}...{/var}` removem a linha inteira quando vazio. Preços em `R$ 1.234,56`. `{desconto}` → `-25% OFF`.
- `scheduleBatch` (§5.3) — determinístico, testado com janelas que cruzam meia-noite.
- `isWithinOperatingWindow` — usa timezone do tenant.
- `shuffleInterleaved(items)` — round-robin entre fontes após embaralhar cada fonte; na F1 há só Shopee e MANUAL, mas a função já é genérica.
- `parseProductUrl(url)` → `{source, externalId}` para Shopee/ML/Amazon/Magalu (F1 só resolve Shopee; outros retornam `unsupported` com mensagem clara na UI).
- `generateSubId(pattern, ctx)`.

## 8. Web (Next.js) — telas da F1

Layout: sidebar (Principal/Configurações), topbar com pills de status alimentadas pelo WS, tema escuro com acento `#14b8a6`. Estado servidor com TanStack Query; WS via hook `useRealtime()`.

| Tela | Conteúdo |
|---|---|
| `/login` | e-mail/senha |
| `/` Visão Geral | cards: WA (status/telefone), Shopee (status), fila (n/limite), lotes ativos com progresso, últimos 10 erros |
| `/produtos` Buscar Produtos | abas por marketplace (só Shopee ativa; demais "em breve"); sub-abas Captura / Explorar Categorias / Mais Buscados / Lojas Favoritas / Por Links-CSV; filtros; grid de cards (imagem, badge desconto, título, preço, vendas, comissão, checkbox, "Copiar Texto + Link"); "Selecionar todos", "Salvar selecionados"; contador "Produtos salvos na fila n/limite" |
| `/enviar` Enviar Ofertas | tabela da fila (produto, loja, preço, desc., status, remover), "Selecionar todos", "Embaralhar"; painel de grupos com checkboxes e prefixo `[CANAL]/[GRUPO]`; "Personalização do disparo": nome, intervalo (min), formato Imagem/Preview, template; previsão de término; botão "Criar lote"; lista de lotes com progresso e pause/resume/cancel |
| `/config/whatsapp` | sessões; botão conectar (QR renderizado do WS, ou pair code com telefone); lista de grupos com badge admin; "Sincronizar grupos" |
| `/config/templates` | editor com lista de variáveis clicáveis e preview ao vivo |
| `/config/shopee` | App Key/Secret/tag de afiliado; botão "Testar conexão"; padrão de SubID |
| `/config/conta` | nome, senha, janela de operação, limite de fila, rate limit |
| placeholders | Dashboard & Métricas, Espelhamento, Gestor de Tráfego IA, Afiliados, Central de Cupons, Conexão ML/Amazon/Magalu — página "Disponível na fase X" |

## 9. Deploy

- `docker-compose.yml` (dev): postgres, redis. Apps rodam com `pnpm dev`.
- `docker-compose.prod.yml`: postgres, redis, api, worker, web, caddy; `Caddyfile` com domínio via env; volumes `pgdata`, `uploads`.
- `deploy.sh`: `git pull`, `docker compose -f docker-compose.prod.yml up -d --build`, `prisma migrate deploy`.
- `.env.example` documenta todas as variáveis (`DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, `SHOPEE_MOCK`, `DOMAIN`).
- Seed: cria tenant "default", usuário `OWNER` com e-mail/senha das envs `SEED_USER_EMAIL`/`SEED_USER_PASSWORD`, template padrão, janela 07:30–23:30.

## 10. Testes da F1

- `core`: 100% das funções de §7 com casos de borda (janela cruzando meia-noite, lote vazio, template sem variáveis, URLs inválidas).
- `marketplaces/shopee`: assinatura HMAC, parsing de resposta com fixtures, modo mock.
- `api`: login, tenant isolation (usuário A não vê fila de B), criar lote gera N jobs com `runAt` correto, `QUEUE_FULL`.
- `worker`: `send-offer` com `WhatsAppGateway` mock — idempotência, pausa, reagendamento fora da janela, modo PREVIEW vs IMAGE.
- `web` (Playwright): login → conectar WA (gateway mock emite QR) → buscar (mock) → salvar → criar lote → ver progresso.

## 11. Critérios de aceite

- [ ] `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` sobe tudo em máquina limpa.
- [ ] Reiniciar o worker com WA conectado não exige novo QR.
- [ ] Lote de 5 produtos, intervalo 1 min, 2 grupos: 10 `SendLog`, previsão de término correta, UI atualiza sem refresh.
- [ ] Lote criado às 23:25 com janela até 23:30 e intervalo 10 min: 1º item sai às 23:25, 2º às 07:30 do dia seguinte.
- [ ] Todos os testes passam em CI local (`pnpm test`).
- [ ] `deploy.sh` no VPS entrega o painel em HTTPS.

## 12. Decisões registradas na F1-B

- (a) Canais/newsletter ficam deferidos para a F2 — Baileys não expõe listagem estável de canais no momento. A UI não deve exibir o prefixo `[CANAL]` até essa listagem ser confiável.
- (b) `GET /marketplaces` lista todas as lojas de uma vez, em vez de `GET /marketplaces/:kind` para leitura individual (o `:kind` continua existindo para as operações de escrita/conexão).
- (c) `GET /me` não inclui `settings` — o cliente deve chamar `GET /settings` separadamente.
- (d) Sem CORS: o app web faz proxy same-origin de `/api/*`. A proteção contra CSRF na F1 é `SameSite=Lax` + `httpOnly` no cookie de sessão.
- (e) O commit `8d8fccc` tem um trailer de atribuição divergente do padrão vigente; isso foi aceito conscientemente e o histórico não foi reescrito.
