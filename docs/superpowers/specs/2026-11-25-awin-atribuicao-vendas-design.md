# Atribuição de vendas Awin por grupo + página Vendas

Data: 2026-11-25 · Subprojeto A da leva "novidades da API da Awin" (ordem: D → **A** → B → C).
Base: branch `feat/awin-token-pat` (subprojeto D, ainda sem merge).

## Objetivo

Saber **quais grupos (WhatsApp/Telegram) geram vendas e comissão na Awin**, com as vendas
gravadas no banco e contabilizadas numa página "Vendas" do painel. Sem avisos por mensagem
(decisão do usuário).

## Situação atual (o que impede hoje)

- `send-offer.ts` gera o link de afiliado **uma vez por item** e manda a mesma mensagem a todos os
  grupos (`sendPlainMessages`). `generateSubId` tem `{group}` mas ninguém passa o grupo.
- Para o dono (chave `siteLinks`), o link enviado é `PUBLIC_SITE_URL/ofertas/<slug>`
  (`publish-offer.ts`); o botão "comprar" da página usa `ProductListing.affiliateUrl` gravado na
  indexação — clickref congelado, sem redirecionamento nem rastreio de clique.
- Não existe modelo de venda/comissão. Clickrefs passam por `sanitizeSubId` (alfanumérico, ≤ 50).
- A Awin aceita `clickref`, `clickref2` … `clickref6` no `cread.php` e devolve `clickRef`…
  `clickRef6` nas transações.

## Desenho

### 1. Código de rastreio do canal
- Novo campo `trackCode String?` (único por tenant) em `WaGroup` e `TelegramChat`: 6 caracteres
  alfanuméricos, gerado sob demanda (lazy) na primeira vez que o canal recebe um envio e reaproveitado.
  Prefixo `w` (WhatsApp) / `t` (Telegram) + 5 aleatórios, ex.: `wK7p2Q`.
- Helper `ensureTrackCode(db, channel)` em `packages/db` (retry em colisão).

### 2. Link por canal no envio
- `send-offer.ts`: a mensagem passa a ser montada **por grupo** (o render do template continua uma
  vez; só o link é trocado por grupo). Para cada grupo:
  - link do site → `<site>/ofertas/<slug>?c=<trackCode>&b=<batchId>`;
  - link direto Awin (sem site) → link Awin com `clickref2=<trackCode>` e `clickref3=<batchId>`
    (o `clickref` atual — subId do afiliado ou padrão — continua igual);
  - demais lojas sem site → inalterado.
- `send-telegram.ts`: mesma regra por chat.
- Espelhamento e conversor do Telegram ficam fora (YAGNI; podem usar o mesmo helper depois).
- Helper puro `withAwinChannelRefs(url, { channel, batch })` em `packages/marketplaces/src/awin`
  (só mexe em URLs `awin1.com/cread.php`; demais retornam iguais).

### 3. Redirecionamento com contagem de clique
- Endpoint público `GET /api/v1/r/:listingId?c=&b=` (rate limit leve, como `/public/group-links`):
  1. busca o `ProductListing` (tenant público já resolvido como em `/deals/:slug`);
  2. grava `OfferClick { tenantId, listingId, channelCode?, batchId?, clickedAt }`
     (falha ao gravar não impede o redirect);
  3. 302 para o `affiliateUrl` com `withAwinChannelRefs` aplicado quando é Awin; senão a URL como está.
  - `c`/`b` sanitizados (alfanumérico, ≤ 32); valores inválidos são ignorados.
- Página `/ofertas/[slug]` e `deal-card.tsx`: o botão "comprar" aponta para
  `/api/v1/r/<listingId>` repassando `c` e `b` da URL da página (quando existirem).

### 4. Vendas no banco
Modelo `AffiliateSale`:
`id, tenantId, network ('AWIN'), externalId, advertiserId, advertiserName?, saleAmount Decimal,
commissionAmount Decimal, currency, status (PENDING|APPROVED|DECLINED|DELETED), transactionDate,
validationDate?, clickRef?, clickRef2?, clickRef3?, clickRef4?, clickRef5?, clickRef6?,
channelKind? ('WHATSAPP'|'TELEGRAM'), channelId? (WaGroup.id ou TelegramChat.id),
channelName? (snapshot), batchId?, source ('API'|'WEBHOOK'), raw Json, createdAt, updatedAt`.
`@@unique([tenantId, network, externalId])`, índices em `(tenantId, transactionDate)` e
`(tenantId, channelId)`.

- Cliente `listAwinTransactions(creds, { startDate, endDate, dateType })` em
  `packages/marketplaces/src/awin/transactions.ts`: `GET https://api.awin.com/publishers/{id}/transactions/`
  com `startDate`/`endDate` (`yyyy-MM-ddTHH:mm:ss`), `timezone=UTC`, janela ≤ 31 dias,
  `Authorization: Bearer <token>`; 401/403 → `AwinApiError('AWIN_UNAUTHORIZED')`. Mapper puro
  `mapAwinTransaction(raw)` (campos: `id`, `advertiserId`, `advertiserName?`, `saleAmount.amount/currency`,
  `commissionAmount.amount`, `commissionStatus`, `transactionDate`, `validationDate`,
  `clickRefs.clickRef…clickRef6` — tolerar formatos achatados `clickRef`, `clickRef2`…).
- Resolução do canal: `clickRef2` → `trackCode` → `WaGroup`/`TelegramChat`; `clickRef3` → `batchId`.
- Sincronização no worker (`awin-sales-sync`): agendador no mesmo padrão de
  `coupon-sync-scheduler` (setInterval + job por tenant com jobId deduplicado): **a cada hora**
  janela dos últimos 7 dias; **1×/dia** janela de 31 dias (`dateType=transaction`). Upsert
  idempotente (atualiza status/valores/validação). Só roda para tenants com `publisherId` e token.
  401 reaproveita o tratamento do subprojeto D (`AWIN_TOKEN_ERROR`).
- Webhook: `POST /api/v1/webhooks/awin/:token` (público, sem sessão). `token` = segredo aleatório
  (32 bytes base64url) por tenant, guardado em `Setting` (`awinWebhookToken`), comparado em tempo
  constante. Corpo JSON das "Transaction notifications" da Awin → mesmo mapper/upsert com
  `source=WEBHOOK` (o sync posterior pode sobrescrever com dados da API). Corpo inválido → 400;
  token inválido → 404. Sempre responde rápido (sem chamadas externas).
- Rotas autenticadas: `GET /api/v1/sales/awin-webhook` (mostra URL completa, gera token se não
  existir) e `POST /api/v1/sales/awin-webhook/rotate`.

### 5. Painel — página "Vendas"
Nova rota `(app)/vendas` + item no menu lateral. Endpoint `GET /api/v1/sales/summary?from&to`:
- cartões: comissão aprovada, comissão pendente, nº de vendas, cliques (OfferClick) e conversão
  (vendas ÷ cliques) no período;
- tabela por canal (grupo): cliques, vendas, comissão (pendente/aprovada), conversão;
- tabela por loja (anunciante) e série por dia (comissão);
- `GET /api/v1/sales?from&to&status&page` — lista das últimas vendas.
- Bloco "Configurar notificações da Awin" com a URL do webhook (copiar) e passo a passo
  (Awin → Toolbox → Transaction notifications → POST → colar URL).
- Período padrão: últimos 30 dias. Valores em BRL formatados; outras moedas exibidas como vieram.

## Fora do escopo
Outras redes (modelo já tem `network`), avisos por mensagem, espelhamento/conversor Telegram com
código de canal, atribuição retroativa de vendas antigas sem `clickRef2`.

## Testes
- `withAwinChannelRefs` (adiciona/sobrescreve clickref2/3, ignora não-Awin, preserva clickref).
- `send-offer`: grupos diferentes recebem links diferentes (site e Awin direto); demais lojas iguais.
- Redirect: grava clique, 302 com refs, listing inexistente → 404, falha no insert não quebra.
- `mapAwinTransaction` com fixture; `listAwinTransactions` (URL, auth, 401).
- Upsert idempotente + resolução do canal por `clickRef2`.
- Webhook: token válido grava; inválido 404; corpo inválido 400.
- `sales/summary`: agregações por canal/loja/dia e conversão.
- Web: página Vendas renderiza cartões/tabelas a partir de mock.
