# Módulo de Automação — Descoberta e Disparo Automático de Ofertas

**Data:** 2026-09-17
**Status:** Aprovado
**Depende de:** 2026-09-14-f1-nucleo-disparo-design.md (Batch/BatchItem/SendLog), 2026-09-15-f3-ingestao-ml-amazon-magalu-design.md (scrapers, product-enrich)

---

## 1. Resultado Esperado

O usuário afiliado configura uma ou mais **regras de automação** (`AutomationRule`) e o sistema passa a:

1. **Buscar promoções sozinho** por palavra-chave em Shopee (API oficial), Mercado Livre, Amazon e Magalu (scraping de página de busca), e opcionalmente na rede de afiliados **Awin** (catálogo sincronizado por feed oficial).
2. **Filtrar** os resultados por desconto mínimo, faixa de preço e keywords bloqueadas.
3. **Enviar automaticamente** 1 oferta por ciclo para os grupos de WhatsApp configurados na regra, respeitando intervalo entre envios, janela de operação do tenant e limite diário por regra.
4. **Alternar marketplaces de forma aleatória** ("mix") a cada ciclo, evitando enviar sempre da mesma loja em sequência.
5. Cada regra é independente — o usuário pode ter, por exemplo, uma regra "Eletrônicos até R$300" mandando para o Grupo A e outra "Moda com 40%+ OFF" mandando para o Grupo B, cada uma com suas próprias keywords, marketplaces e template.
6. **Ver e controlar o que está para sair**: cada regra tem uma fila visível ("programado para disparar") que o usuário pode consultar e remover itens antes do envio.
7. **Inserir manualmente**: o usuário pode colar um link de produto específico (furando a descoberta automática) ou escolher um cupom com um template pré-configurado, para qualquer regra — esses itens saem antes dos descobertos automaticamente.

Este módulo **não substitui** a fila manual (`/produtos`) nem o disparo manual de lotes (`/enviar`) — ambos continuam existindo. A automação roda em paralelo, criando lotes de 1 item sozinha, pelo mesmo pipeline de envio já existente.

---

## 2. Fora de Escopo (v1)

- Múltiplas variantes de template sorteadas por envio (o `renderTemplate` atual usa 1 corpo fixo por `Template`; manter assim).
- Janela de horário por regra (usa a `OperatingWindow` do tenant, já existente).
- Descoberta via "página de ofertas do dia" (hub de deals) dos marketplaces — usar busca por palavra-chave, que é server-rendered e mais estável.
- Webhook de notificação de transações da Awin (usar apenas o datafeed, via polling periódico).
- Seleção de anunciantes/marcas específicos da Awin (v1 usa seleção por **categoria**).

---

## 3. Modelo de Dados (novo)

```prisma
enum AutomationLogAction {
  DISCOVERED
  DISPATCHED
  SKIPPED
  ERROR
}

model AutomationRule {
  id               String    @id @default(cuid())
  tenantId         String
  tenant           Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name             String
  enabled          Boolean   @default(false)
  marketplaces     MarketplaceKind[]   // pool do mix aleatório (inclui AWIN)
  keywords         String[]            // obrigatórias (OR entre si) — busca por marketplace
  blockedKeywords  String[]
  minDiscountPct   Int?
  minPrice         Decimal?  @db.Decimal(12, 2)
  maxPrice         Decimal?  @db.Decimal(12, 2)
  maxOffersPerDay  Int       @default(20)
  intervalMin      Int       @default(60)
  sessionId        String
  session          WaSession @relation(fields: [sessionId], references: [id])
  groupJids        String[]
  templateId       String
  template         Template  @relation(fields: [templateId], references: [id])
  mediaMode        MediaMode @default(IMAGE)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @default(now()) @updatedAt
  logs             AutomationLog[]

  @@index([tenantId, enabled])
}

model AutomationLog {
  id          String               @id @default(cuid())
  tenantId    String
  tenant      Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ruleId      String
  rule        AutomationRule       @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  marketplace MarketplaceKind
  action      AutomationLogAction
  productId   String?
  reason      String?
  createdAt   DateTime             @default(now())

  @@index([tenantId, ruleId, createdAt])
}
```

Sem colunas de contador (`sentToday`, `lastDispatchedAt` etc.): `maxOffersPerDay`, "último disparo" e "buscados hoje" da UI são sempre derivados de `AutomationLog` (`action = DISPATCHED`/`DISCOVERED`, filtrado por `createdAt >= início do dia no timezone do tenant`). Evita drift entre contador e realidade.

`MarketplaceKind` e `ProductSource` ganham o valor `AWIN`.

`MarketplaceConnection` ganha um campo `settings Json?` (nullable, genérico) — usado pela Awin para guardar as categorias sincronizadas (`{ categoryIds: string[] }`); os demais marketplaces continuam sem usá-lo.

### 3.1 Fila visível por regra + inserção manual (produto ou cupom)

```prisma
enum AutomationItemKind {
  PRODUCT
  COUPON
}

enum AutomationQueueStatus {
  PENDING
  DISPATCHED
  REMOVED
}

model AutomationQueueItem {
  id           String                 @id @default(cuid())
  tenantId     String
  tenant       Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ruleId       String
  rule         AutomationRule         @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  kind         AutomationItemKind
  productId    String?
  product      Product?               @relation(fields: [productId], references: [id], onDelete: Cascade)
  couponId     String?
  coupon       Coupon?                @relation(fields: [couponId], references: [id], onDelete: Cascade)
  manual       Boolean                @default(false)  // true = inserido manualmente pelo usuário
  status       AutomationQueueStatus  @default(PENDING)
  addedAt      DateTime               @default(now())
  dispatchedAt DateTime?

  @@index([tenantId, ruleId, status, addedAt])
}
```

Essa tabela é a **fila real** de cada `AutomationRule` — o que a tela "programado para disparar" exibe é exatamente `AutomationQueueItem` com `status: PENDING`, ordenado por `addedAt`. Ela existe em vez de a automação decidir tudo "na hora" (§5) porque o usuário precisa poder **ver e remover** um item antes de ele sair, e **inserir** algo manualmente:

- **Descoberta automática** (§4) passa a *popular* esta fila (`manual: false`) em vez de disparar direto — o scheduler (§5) só executa o próximo item `PENDING` da fila de uma regra, não pula mais direto do "achou produto" para "criou lote".
- **Remover manualmente**: `DELETE /automations/:ruleId/queue/:itemId` → `status = REMOVED`. Item removido nunca é escolhido pelo scheduler.
- **Adicionar link manualmente**: usuário cola uma URL de produto (qualquer marketplace suportado, incluindo Awin) para uma regra específica. Reaproveita o mesmo caminho de `POST /products/import` (síncrono para Shopee/Awin, `product-enrich` em background para ML/Amazon/Magalu) para resolver o produto, depois cria o `AutomationQueueItem { kind: PRODUCT, manual: true }`.
- **Adicionar cupom manualmente**: usuário escolhe (ou cria) um `Coupon` já existente (`store`, `code`, `description`, `expiresAt` — modelo já existe no schema) e escolhe um **template de cupom pré-configurado** (ver §3.2), criando `AutomationQueueItem { kind: COUPON, manual: true, couponId }`.
- **Prioridade**: o scheduler (§5, passo 4-6) sempre despacha o item manual mais antigo (`manual: true, status: PENDING`) antes de sortear marketplace/produto descoberto automaticamente — item manual expressa uma escolha explícita do usuário e não deve ficar esperando atrás do mix aleatório.
- Item passa o mesmo **portão de validação** do §5.1 antes de virar `Batch` — inclusive um link manual que falhar ao ser resolvido (produto não encontrado, marketplace fora do ar) fica com o `Product` associado incompleto e é pulado (`SKIPPED`), sem travar a fila; o usuário vê o erro e pode remover ou tentar de novo.

### 3.2 Template de cupom

`Template` ganha um discriminador para diferenciar template de produto (atual) de template de cupom:

```prisma
enum TemplateKind {
  PRODUCT
  COUPON
}
```

Adiciona `kind TemplateKind @default(PRODUCT)` em `Template`. Um novo `renderCouponTemplate(body, coupon, ctx)` em `packages/core/src/template.ts` (ao lado do `renderTemplate` atual) expõe as variáveis do cupom: `{codigo}`, `{loja}`, `{descricao}`, `{validade}`. Ao criar/editar um template com `kind: COUPON`, a tela de templates (`/config/templates`) mostra essas variáveis em vez das de produto. Na inserção manual de cupom (§3.1), o seletor de template só lista templates `kind: COUPON`.

---

## 4. Descoberta de Produtos

### 4.1 Shopee, Mercado Livre, Amazon, Magalu

- **Shopee**: `adapter.search(creds, { keyword, ... })` já existe (`packages/marketplaces`) — usado como está.
- **Mercado Livre / Amazon / Magalu**: novo método `discoverByKeyword(keyword): Promise<string[]>` por scraper, que busca a página pública de **resultados de busca** (não o hub de "ofertas do dia", que costuma depender de JS) e extrai as URLs de produto da listagem, ex:
  - Mercado Livre: `https://lista.mercadolivre.com.br/{keyword}`
  - Amazon: `https://www.amazon.com.br/s?k={keyword}`
  - Magalu: `https://www.magazineluiza.com.br/busca/{keyword}/`
  As URLs encontradas alimentam o `fetchByUrls` já existente (mesmo caminho do `product-enrich`), preservando cache e rate-limit por domínio.

### 4.2 Awin (novo)

- Requer conectar uma conta Awin: `MarketplaceConnection { kind: AWIN }` com `encryptedCredentials` guardando `{ publisherId, apiToken }` e `settings.categoryIds` (categorias escolhidas pelo usuário na tela de conexão, ex: "Eletrônicos", "Casa e Jardim").
- Novo job periódico `awin-feed-sync` (BullMQ repeatable, ex: a cada 6h): para cada tenant com conexão Awin ativa, baixa o datafeed (CSV/gzip) de cada categoria configurada via a URL estável de feed (`.../productdata-darwin-download/publisher/{publisherId}/{token}/...`), faz parse e `upsert` em `Product`:
  - `source: 'AWIN'`, `externalId: aw_product_id`
  - `title: product_name`, `price: search_price`, `originalPrice: rrp_price` (quando `rrp_price > search_price`), `discountPct` calculado
  - `images: [merchant_image_url]`, `shopName: merchant_name`, `originalUrl: aw_deep_link` (**já vem com o link de afiliado — não precisa gerar depois**)
  - `raw: { category: merchant_category, brand: brand_name, inStock: in_stock }`
- Diferença importante: para Awin, "descoberta" (passo 5 do §5) não faz scrape/API na hora — o catálogo já está sincronizado. Popular a `AutomationQueueItem` (§3.1) de uma regra com marketplace Awin é só uma consulta em `Product { source: AWIN }` filtrando pelas keywords/filtros da regra, sem chamada externa.
- `send-offer.ts`: a ramificação atual de geração de link de afiliado (`resolveTagAdapter(product.source).toAffiliateLink`) precisa de uma exceção para `AWIN`, tratando-o como `MANUAL` nesse ponto (usa `product.originalUrl` diretamente, sem chamar adapter nenhum).

---

## 5. Motor de Agendamento (worker)

Novo `AutomationScheduler`, no mesmo padrão do `MirrorListener` já existente (`apps/worker/src/mirror/listener.ts`):

- Ao iniciar, carrega todas as `AutomationRule` com `enabled: true` em memória; recarrega ao receber o evento pub/sub `automation.rules.changed` (mesmo canal Redis `REDIS_EVENTS_CHANNEL` já usado pelo mirror).
- Um `setInterval` de ~30s percorre as regras em memória. Para cada regra, verifica:
  1. Já passou `intervalMin` desde o último `DISPATCHED` (via `AutomationLog`)?
  2. Está dentro da `OperatingWindow` do tenant (`isWithinOperatingWindow`, já existe em `@afilados/core`)?
  3. Ainda não atingiu `maxOffersPerDay` hoje?
  Se todas as condições passarem:
  4. **Item manual primeiro**: se existir `AutomationQueueItem { manual: true, status: PENDING }` para a regra, pega o mais antigo — pula os passos 5 (mix/descoberta) direto para o 6.
  5. Caso contrário: sorteia 1 marketplace entre `rule.marketplaces` (mix aleatório). Se não houver `AutomationQueueItem { manual: false, status: PENDING }` casando com aquele marketplace, dispara a descoberta (§4) para populá-la e aguarda o resultado antes de prosseguir; loga `DISCOVERED`/`SKIPPED` conforme o caso. Sorteia 1 item elegível entre os `PENDING` resultantes.
  6. Roda o portão de validação (§5.1) no produto/cupom do item escolhido. Se passar: cria um `Batch` de 1 item (produto) ou envia a mensagem de cupom diretamente (ver nota abaixo) para `sessionId`/`groupJids`/`mediaMode`/template da regra (`runAt = now`), reaproveitando `enqueueBatchItems`/`sendOffer` já existentes; marca o `AutomationQueueItem` como `DISPATCHED`. Se falhar: marca `REMOVED`-like (loga `SKIPPED`) e volta ao passo 4/5 para tentar o próximo item elegível na mesma rodada.
  7. Loga `DISPATCHED` (ou `ERROR` se a criação do lote falhar).

**Nota sobre cupom no `Batch`**: `BatchItem.productId` passa a ser opcional, e ganha `couponId` opcional (exatamente um dos dois preenchido — validado na aplicação, não via constraint de banco). `sendOffer.ts` ganha uma ramificação: quando `couponId` está setado, monta a mensagem com `renderCouponTemplate` (§3.2) em vez do caminho atual de `ProductData`/link de afiliado, e envia como texto simples. **A validar na implementação**: `OutgoingMessage` (`apps/worker/src/wa/gateway.ts`) hoje só tem `image`/`preview` — precisa de um novo variant `{ kind: 'text'; text: string }`, implementado no `baileys-gateway.ts` com um envio de texto puro (`sock.sendMessage(jid, { text })`).

Reaproveitar o pipeline de `Batch` existente significa que rate-limit, geração de link de afiliado, janela de operação e `SendLog` **não são reimplementados** — a automação só decide *o quê* e *quando* enfileirar.

### 5.1 Portão de validação — nunca disparar produto incompleto ou de descoberta falha

Antes do passo 6 (criar o `Batch`), o produto sorteado passa por uma checagem obrigatória. Se falhar, o item é descartado (loga `SKIPPED` com o motivo) e o scheduler tenta outro produto elegível na mesma rodada — **nunca** cria o lote com dado capenga:

- `raw.pendingEnrich` não pode ser `true` (produto ainda em enriquecimento em background — mesmo estado já usado por `QueueItemStatus.PENDING_ENRICH`).
- `title` não pode estar vazio nem ser o placeholder `"Importando…"`.
- `price > 0`.
- `images.length > 0`.
- `originalUrl` deve ser uma URL válida do marketplace de origem (reaproveita `parseProductUrl`/checagem de host já usada em `products.ts`); para Awin, deve começar com o domínio de tracking da rede.

Isso vale tanto para produto vindo de descoberta nova (scrape/API na hora) quanto de produto já existente no banco (Awin sincronizado, ou remanescente de fila manual): a automação só considera "elegível" o que passa nessa checagem.

**Falha de descoberta não derruba o disparo de outras regras/marketplaces:**
- Se o scrape/API de um marketplace falhar (timeout, mudança de layout, erro HTTP) durante o passo 5, o erro é capturado, logado como `ERROR` com o motivo, e **aquele ciclo daquela regra é pulado** — não tenta enviar produto nenhum daquele marketplace nesta rodada. O scheduler segue normalmente para as outras regras/próxima rodada; uma falha nunca propaga para travar o `setInterval` nem para reenviar um produto antigo/errado como fallback.
- Se o `awin-feed-sync` falhar no meio do parse de um feed (CSV corrompido, token inválido, HTTP erro), a sincronização daquela categoria é abortada **sem** aplicar upserts parciais daquele arquivo — só produtos de linhas já validadas e processadas com sucesso antes do erro permanecem; a conexão Awin é marcada `ConnectionStatus.ERROR` com `lastError`, e o próximo ciclo de sync tenta de novo do zero.
- Nenhum retry automático de disparo: se um `Batch` de automação falhar no envio (ex: WhatsApp desconectado), ele segue o mesmo tratamento de erro que lotes manuais já têm hoje (`BatchItemStatus.ERROR` via `sendWorker.on('failed', ...)` em `main.ts`) — a automação não reenvia sozinha, só tenta um novo produto no próximo ciclo natural.

---

## 6. API

Novas rotas em `apps/api/src/routes/automations.ts` (padrão de `routes/batches.ts`):

- `GET /automations` — lista regras do tenant com estatísticas derivadas do log (frescos p/ enviar, buscados hoje, último disparo).
- `POST /automations` — cria regra (valida sessão WA conectada, grupos pertencem à sessão, template existe — mesmas validações de `batchesRoutes`).
- `PATCH /automations/:id` — edita regra.
- `POST /automations/:id/toggle` — liga/desliga (publica `automation.rules.changed`).
- `DELETE /automations/:id`.
- `GET /automations/:id/logs` — histórico paginado (para depuração pelo usuário).
- `GET /automations/:id/queue` — lista `AutomationQueueItem { status: PENDING }` da regra ("programado para disparar"), com produto/cupom incluído.
- `DELETE /automations/:id/queue/:itemId` — remove um item da fila (`status = REMOVED`).
- `POST /automations/:id/queue/link` — adiciona produto manual por URL (`{ url }`), reaproveitando a resolução de `products.ts`.
- `POST /automations/:id/queue/coupon` — adiciona cupom manual (`{ couponId, templateId }` ou `{ coupon: {...dados novos...}, templateId }` para criar o cupom na hora).
- Conexão Awin: estende `routes/marketplaces.ts` com o fluxo de conectar (token + publisherId) e escolher categorias, reaproveitando o padrão de `loadShopeeCredentials`/`encryptedCredentials` já usado pelas outras conexões.

## 7. UI

- Nova página `/automacoes`, adicionada ao menu lateral entre "Buscar Produtos" e "Enviar Ofertas".
- Formulário de regra: nome, marketplaces (chips multi-select, incluindo Awin se conectado), keywords obrigatórias/bloqueadas, desconto mín., faixa de preço, intervalo, limite/dia, sessão + grupos WhatsApp de destino, template.
- Painel por regra: status (ligado/desligado), "frescos p/ enviar", "buscados hoje", "último disparo" — todos derivados de `AutomationLog` via API.
- **Fila "Programado para disparar"** dentro do card de cada regra: lista os `AutomationQueueItem` `PENDING` em ordem (item manual sempre no topo, com selo "manual"), com botão de remover por item. Um botão "Adicionar manualmente" abre um pequeno formulário com duas abas: **Link** (campo de URL) ou **Cupom** (seleciona um cupom existente da Central de Cupons ou cria um novo, e escolhe um template `kind: COUPON`).
- `/config/templates`: ao criar/editar template, um seletor "Tipo: Produto / Cupom" define quais variáveis aparecem no editor (produto: `{titulo} {preco} {desconto} {link}...`; cupom: `{codigo} {loja} {descricao} {validade}`).
- Tela de conexão Awin (dentro de `/marketplaces`, como as demais): campos publisherId + token, seletor de categorias (lista fixa vista no painel Awin: Roupas e Acessórios, Computadores e Softwares, Eletrônicos, Saúde e Beleza, Casa e Jardim, Eletrodomésticos, Joias, Esportes, etc.).

---

## 8. Riscos / Pontos a Validar na Implementação

1. **Scraping de página de busca (ML/Amazon/Magalu)**: layout pode mudar sem aviso; seguir o padrão já usado em `packages/marketplaces/src/scrapers/*` (seletores com fallback, `raw` guardando o HTML relevante para depuração). Falha em um marketplace não deve travar o scheduler — apenas loga `ERROR` e tenta outro na próxima rodada.
2. **Rate-limit dos marketplaces**: a busca por keyword roda por regra, então várias regras ativas com keywords parecidas podem gerar chamadas repetidas — usar o mesmo cache Redis por keyword+marketplace (TTL curto, ex: 15min) já usado no `product-enrich` para não martelar o site.
3. **Token da Awin**: confirmar durante a implementação se o token gerado no painel Awin é de uso duradouro (Bearer fixo) ou expira — se expirar, precisamos de refresh automático ou aviso ao usuário para reconectar (mesmo padrão de `ConnectionStatus.ERROR` + `lastError` já usado em `MarketplaceConnection`).
4. **Volume do feed Awin**: com 1,3M produtos na rede toda, mesmo 1-2 categorias podem ter dezenas de milhares de linhas — o parse/upsert do `awin-feed-sync` deve ser feito em streaming (não carregar o CSV inteiro em memória) e em lotes (`createMany`/`upsert` em chunks).
5. **`BatchItem.productId` opcional**: hoje é obrigatório e várias queries/telas assumem `item.product` sempre presente (ex: `toApiProduct(i.product)` em `routes/batches.ts`). Migrar para opcional exige revisar todo lugar que lê `BatchItem.product` sem checar null — não é só a migration do schema.
6. **Novo `OutgoingMessage` kind `text`**: hoje só existe `image`/`preview` (`apps/worker/src/wa/gateway.ts`); confirmar no Baileys se `sock.sendMessage(jid, { text })` já é suficiente ou se precisa de opções extras (ex: link preview automático do WhatsApp para links dentro do texto do cupom).
