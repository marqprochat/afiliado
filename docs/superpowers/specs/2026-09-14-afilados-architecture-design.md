# Afilados — Arquitetura Geral

**Data:** 2026-09-14
**Status:** Aprovado (brainstorm com o dono do projeto)
**Referência de produto:** Afiliados Pro Bot (afiliadosprobot.com.br) — automação de ofertas de afiliado para grupos de WhatsApp.

## 1. Objetivo

Construir uma plataforma de automação de ofertas para afiliados que:

1. Conecta um ou mais números de WhatsApp (via Baileys) e mapeia grupos, comunidades e canais.
2. Minera produtos na Shopee (API oficial) e ingere produtos de Mercado Livre, Amazon e Magalu (extensão + scraping).
3. Formata ofertas com templates e variáveis dinâmicas, converte links para a tag de afiliado do usuário e dispara em lotes com cadência e janela de operação.
4. Espelha ofertas de grupos/canais de terceiros para os grupos do usuário, trocando links.
5. Mantém uma central de cupons, modera grupos (guilhotina/anti-bot) e entrega métricas de disparo e de membros.

**Modo de operação inicial:** single-tenant (um usuário), mas com a estrutura multi-tenant e de billing pronta desde o primeiro commit, para que a evolução para SaaS (Fase 7) não exija migração de dados nem refatoração.

## 2. Decisões fixas

| Decisão | Escolha | Motivo |
|---|---|---|
| Linguagem | TypeScript em tudo | Baileys só roda em Node; uma linguagem só |
| Monorepo | pnpm workspaces + Turborepo | Compartilhar `db`, `core`, `shared` entre api/worker/web |
| API | Fastify + Zod + Prisma | Leve, tipado, rápido de testar |
| Worker | Node + Baileys + BullMQ (Redis) + node-cron | Sessões WA vivem fora da API |
| Web | Next.js 15 (App Router) + Tailwind + shadcn/ui | UI dark, acento verde-água, mesma IA do modelo |
| Banco | PostgreSQL 16 | Relacional, JSONB para payloads de marketplace |
| Fila/cache/pubsub | Redis 7 | BullMQ + eventos api↔worker |
| Auth | e-mail/senha, sessão em cookie httpOnly (Lucia) | Simples; troca por OAuth na F7 se quiser |
| Infra | Docker Compose no VPS do dono, Caddy para TLS | Já existe VPS |
| Testes | Vitest, Testcontainers (Postgres), Playwright (crítico) | Ver §8 |

## 3. Estrutura do repositório

```
afilados/
├── apps/
│   ├── api/          Fastify: REST + WebSocket para a UI
│   ├── worker/       Baileys, BullMQ processors, crons
│   ├── web/          Next.js
│   └── extension/    Chrome MV3 "Connect" (Fase 3)
├── packages/
│   ├── db/           Prisma schema, migrations, client, seed
│   ├── core/         Domínio puro (sem IO): templates, preço/cupom,
│   │                 conversão de links, janela/cadência, shuffle, DDD→UF
│   ├── marketplaces/ Adapters: shopee, mercadolivre, amazon, magalu
│   └── shared/       Tipos, zod schemas, constantes, eventos
├── docker-compose.yml        dev: postgres, redis
├── docker-compose.prod.yml   prod: + api, worker, web, caddy
├── deploy.sh
└── docs/superpowers/{specs,plans}
```

**Regra de dependência:** `web → shared`; `api → db, core, marketplaces, shared`; `worker → db, core, marketplaces, shared`; `core → shared` apenas. `core` nunca importa Prisma, Baileys ou `fetch`.

## 4. Componentes e responsabilidades

### 4.1 `apps/api`
- Autenticação, sessão, middleware que injeta `tenantId` em toda requisição.
- CRUD de todas as entidades (§5).
- Enfileira jobs no BullMQ (nunca envia WhatsApp diretamente).
- WebSocket `/ws`: repassa eventos do Redis pub/sub para a UI (QR code, status de conexão, progresso de lote, logs de espelhamento).
- Endpoint de busca de produtos que chama os adapters de marketplace de forma síncrona (a busca é interativa).

### 4.2 `apps/worker`
- **WaSessionManager**: uma instância Baileys por `WaSession` ativa; auth-state persistido em Postgres; lock em Redis (`wa:lock:{sessionId}`) garante um único processo por número; reconexão com backoff exponencial; em `loggedOut` marca sessão como `NEEDS_QR` e publica evento.
- **Processors BullMQ**: `send-offer`, `mirror-message`, `scheduled-message`, `coupon-crawl`, `product-enrich`, `image-decorate`.
- **Listeners Baileys**: `messages.upsert` (espelhamento + moderação), `group-participants.update` (analytics + anti-bot), `message-receipt.update` (leitura).
- **Crons**: crawler de cupons (60 min), mensagens institucionais (3 horários), agregação diária de métricas, limpeza de logs.

### 4.3 `apps/web`
Sidebar espelhando o produto modelo:
- **Principal:** Visão Geral, Dashboard & Métricas, Buscar Produtos, Enviar Ofertas, Espelhamento, Gestor de Tráfego IA (placeholder), Afiliados (placeholder).
- **Configurações:** WhatsApp, Template das mensagens, Central de Cupons, API Shopee, Conexão Mercado Livre, Conexão Amazon, Conexão Magalu, Minha Conta.
- Barra superior com pills de status: WhatsApp, Shopee, Mercado Livre, Amazon, Magalu.

### 4.4 `packages/core` (funções puras)
- `renderTemplate(template, product, ctx)` → texto WhatsApp com placeholders (§6).
- `applyCoupon(price, coupon)` → preço final e texto.
- `isWithinOperatingWindow(now, window)` / `nextWindowOpen(now, window)`.
- `scheduleBatch(items, intervalMin, window, startAt)` → lista de `runAt` + previsão de término.
- `shuffleInterleaved(items)` → embaralha evitando blocos monotemáticos por marketplace.
- `extractStoreLinks(text)` → links oficiais reconhecidos (Shopee, ML, Amazon, Magalu); ignora encurtadores e terceiros.
- `toAffiliateLink(url, connection, subId)` — por marketplace.
- `dddToUf(phone)`.
- `flashSaleLabel(endsAt, now)` → "Faltam 47 minutos".

### 4.5 `packages/marketplaces`
Interface comum:
```ts
interface MarketplaceAdapter {
  id: 'shopee' | 'mercadolivre' | 'amazon' | 'magalu';
  checkConnection(conn): Promise<ConnectionStatus>;
  search?(conn, query: SearchQuery): Promise<Product[]>;        // Shopee
  fetchByUrls(conn, urls: string[]): Promise<Product[]>;         // todos
  toAffiliateLink(conn, url: string, subId?: string): Promise<string>;
  fetchCoupons?(conn): Promise<Coupon[]>;
}
```
Cada adapter tem fixtures (JSON/HTML reais gravados) e testes que quebram quando o formato muda.

## 5. Modelo de dados (Prisma, resumido)

Todas as tabelas de negócio têm `tenantId` (FK) + índice composto com a chave de negócio.

| Domínio | Tabelas |
|---|---|
| Conta | `Tenant`, `User`, `Session`, `Plan`, `Subscription`, `Referral` (F7) |
| WhatsApp | `WaSession`(status, phone, authState JSONB), `WaGroup`(jid, name, kind: GROUP/COMMUNITY/CHANNEL, botIsAdmin, memberCount, inviteLink) |
| Marketplaces | `MarketplaceConnection`(kind, encryptedCredentials, affiliateTag, status, lastCheckedAt) |
| Produtos | `Product`(source, externalId, title, price, originalPrice, discountPct, salesCount, commissionPct, images[], shipping, flashSaleEndsAt, couponCode, couponValue, originalUrl, raw JSONB), `QueueItem`(productId, selected, status) |
| Disparo | `Template`, `CtaPhrase`, `Batch`(name, groupJids[], intervalMin, mediaMode: IMAGE/PREVIEW, shuffled, status, estimatedEndAt), `BatchItem`(order, runAt, status), `SendLog`(batchItemId?, mirrorLogId?, groupJid, waMessageId, status, error) |
| Espelhamento | `MirrorRule`(sourceJids[], targetJids[], mode: TEMPLATE/CLONE, mediaMode, badges), `MirrorLog` |
| Cupons | `Coupon`, `Banner` |
| Agendamento | `ScheduledMessage`, `OperatingWindow` |
| Moderação | `ModerationRule`, `ModerationEvent` |
| Analytics | `GroupMemberEvent`(jid, phone, ddd, uf, action, origin, at), `MessageReceipt`, `DailyGroupStats` |

## 6. Templates e variáveis

Placeholders suportados: `{titulo}`, `{preco}`, `{preco_antigo}`, `{desconto}`, `{vendas}`, `{link}`, `{cupom}`, `{oferta_relampago}`, `{frete}`, `{frete_gratis}`, `{frete_full}`, `{cta}`. Blocos condicionais `{#cupom}...{/cupom}` para omitir linhas quando a variável está vazia. Formatação WhatsApp (`*`, `_`, `~`) preservada.

## 7. Fluxos principais

**Disparo em lote:** UI cria `Batch` → API calcula `runAt` de cada item com `core.scheduleBatch` (respeita janela) → um job BullMQ por item com `delay` → worker renderiza, converte link, decora imagem, envia, grava `SendLog`, publica progresso.

**Espelhamento:** `messages.upsert` → regra ativa para o grupo de origem? → `extractStoreLinks` → se vazio, descarta com log → `fetchByUrls` (cache por URL 1h) → `toAffiliateLink` → modo CLONE (texto original com links substituídos) ou TEMPLATE → envia imediatamente aos destinos se dentro da janela; fora dela, agenda para a abertura.

**Moderação:** `messages.upsert` em grupo gerenciado → remetente não-admin com link/convite → `groupParticipantsUpdate(remove)` → `ModerationEvent`. `group-participants.update` com padrão de bot (perfil sem foto + entrada em massa + saída rápida) → remove + bloqueia.

## 8. Confiabilidade, segurança e testes

- **Idempotência:** `SendLog` único por `(batchItemId|mirrorLogId, groupJid)`; retry só sem `waMessageId`.
- **Rate limit:** intervalo do lote + jitter ±15% + teto global por sessão (configurável, padrão 6 msgs/min).
- **Credenciais:** AES-256-GCM com chave em `APP_ENCRYPTION_KEY`.
- **Auth:** cookie httpOnly + SameSite, CSRF em mutações, rate limit no login.
- **Tenant:** nenhuma query sem `tenantId` — helper `db.forTenant(id)` obrigatório.
- **Testes:** `core` unitário (Vitest, alto coverage); adapters com fixtures; API com Testcontainers; worker com `WhatsAppGateway` mockado; Playwright nos fluxos login → conectar WA → criar lote.
- **Observabilidade:** pino JSON, healthchecks `/health` em api e worker, página "Visão Geral" com status de sessões, filas e últimos erros.

## 9. Riscos aceitos

1. Baileys é não-oficial; o número pode ser banido. Mitigação por cadência, jitter, janela e chip dedicado.
2. Scraping de ML/Amazon/Magalu quebra com mudanças de site; adapters isolados e testados com fixtures.
3. Shopee Open Platform exige aprovação; adapter opera em modo mock até as credenciais existirem.

## 10. Roadmap por fase

| Fase | Escopo | Módulos do brief |
|---|---|---|
| **F1 – Núcleo de disparo** | Monorepo, auth, tenant, WA (QR/pair, grupos, admin check), Shopee API (busca, filtros, categorias, mais buscados, lojas, SubID), importar por links/CSV, fila de triagem, templates, lotes + shuffle + cadência + janela + previsão, Imagem/Preview, Visão Geral básica | 1.1, 2.1, 2.3, 3.1, 3.3, 5 |
| **F2 – Espelhamento** | Listeners, extração de links oficiais, Clone/Template, conversão ML/Amazon/Magalu por URL, logs | 6 |
| **F3 – Ingestão ML/Amazon/Magalu** | Extensão Chrome "Connect", conexão por cookies, scraper de metadados, ofertas relâmpago, dedução de cupom | 1.2, 2.2, 3.2 |
| **F4 – Cupons e mídia** | Crawler de cupons, banners, selos na imagem, CTAs rotativas + IA, mensagens institucionais | 3.4, 3.5, 3.6, 4 |
| **F5 – Moderação** | Guilhotina, anti-bot/anti-scraping | 7 |
| **F6 – Analytics/CRM** | Métricas de disparo, membros, churn, DDD→UF, picos, taxa de leitura, export | 8 |
| **F7 – SaaS** | Cadastro, planos, Mercado Pago, trial, programa de afiliados, admin, Meta Ads | 1.3 + billing |

Cada fase recebe seu próprio spec e plano em `docs/superpowers/` antes de começar.
