# Sistema de cupons — busca automática, cadastro manual e validação

## Contexto

A "Central de Cupons" (`apps/web/src/app/(app)/config/cupons/page.tsx`) ainda é só um
`PhasePlaceholder` (fase F4). O model `Coupon` já existe no Prisma e já é consumido pela
automação (`AutomationQueueItem.kind = COUPON`, `renderCouponTemplate`, `isEligibleCoupon`) e
pelos lotes (`BatchItem.couponId`), mas:

- não existe CRUD de cupom — a única criação é `POST /automations/:id/queue/coupon`, que cria o
  cupom inline ao enfileirar;
- nenhuma fonte automática grava em `Coupon`. A extensão só preenche `Product.couponCode` com
  uma regex frágil (`/cupom[:\s]+([A-Z0-9_-]{4,20})/i`) e, na Amazon, grava o texto fixo
  `'CUPOM AMAZON'` em vez do código real;
- não há origem (manual/API/extensão), status de validade nem histórico de verificação.

Pedido do usuário: "o sistema de cupons funcione e tenha uma busca automática; puxar cupons
reais das APIs e algo para tentar encontrar cupons; adicionar cupons manuais; algum modo de
validá-los."

## 1. O que cada marketplace expõe (pesquisa)

| Fonte | Cupom via API oficial? | Detalhe |
|---|---|---|
| **AliExpress** (Affiliate API, já integrada) | **Sim, parcial** | `aliexpress.affiliate.product.query` / `hotproduct.query` / `productdetail.get` devolvem, por produto, o objeto `promo_code_info` com `promo_code` (código vinculado ao PID do afiliado), `code_value` (texto tipo "On order over USD 10, get USD 7 off"), `code_campaigntype` (1 = valor fixo, 2 = percentual), `code_availabletime_start/end`, `code_mini_spend`, `code_quantity` (usos restantes) e `code_promotionurl` (link já com o código). Só aparece em **alguns** produtos, então a busca é por amostragem: varrer páginas de hot products/keywords e coletar os que trazem código. Não existe método "listar todos os cupons". `aliexpress.affiliate.featuredpromo.get` lista campanhas (sem código) e não é usado. **Confirmar ao vivo no spike (Task 0):** preenchimento real do campo para `ship_to_country=BR` e se precisa ser pedido em `fields`. |
| **Awin** (já integrada via datafeed) | **Sim, completo** | Offers API: `POST https://api.awin.com/publisher/{publisherId}/promotions`, com auth `Authorization: Bearer <token>` (token gerado em ui.awin.com/awin-api). Filtros: `membership` (joined/notJoined/all), `type` (voucher/promotion/all), `regionCodes` (ex.: `["BR"]`), `status` (active/expiringSoon/upcoming), paginação de 10–200 por página. Resposta: `promotionId`, `type`, `advertiser.id/name`, `title`, `description`, `terms`, `startDate`, `endDate`, `url`/`urlTracking`, `voucher.code` (`null` quando o publisher não é membro do programa). **Precisa de credenciais novas:** o link de lista de feeds que o usuário já cola (`AwinCredentials.feedListUrl`) usa a chave do datafeed, que é diferente do token da API de publisher. Hoje não temos `publisherId` nem esse token. |
| **Amazon** (Creators API / PA-API 5 — descontinuada em 15/05/2026) | **Não** | `OffersV2` traz preço, economia e "Subscribe & Save", mas não traz cupons de "clipar" nem códigos promocionais; a comunidade confirma que a API não expõe clip coupons, promoções "save at checkout" nem promo codes. O cupom de clipar da Amazon **não tem código** (o desconto é aplicado ao marcar a caixa) e continua sendo informação do produto (`Product.couponValue`), não um `Coupon`. Códigos promocionais da Amazon BR só entram por cadastro manual, colagem de texto ou extensão. |
| **Mercado Livre** | **Não para afiliados** | `/seller-promotions` (inclusive `SELLER_COUPON_CAMPAIGN`, só MLB) é do lado do **vendedor**: exige o OAuth do vendedor e só mostra os cupons dele. O programa de afiliados tem "Cupons de afiliados" (ajuda ML nº 35616) no portal, mas sem API pública. Entrada: manual, colagem de texto ou extensão. |
| **Magalu** (Parceiro Magalu) | **Não** | Não há API pública de parceiros nem de cupons. Entrada: manual, colagem de texto ou extensão. |
| **Shopee** (Affiliate Open API GraphQL, já integrada) | **Não encontrado** | O schema público tem `productOfferV2`, `shopOfferV2`, `shopeeOfferV2` (campanhas e comissões diferenciadas) e relatórios de conversão. Não tem query de voucher. Vouchers da Shopee costumam ser coletados no app. **Confirmar no explorer da Open API durante o spike.** Entrada: manual ou colagem de texto. |

**Resumo:** puxar cupons reais por API oficial só dá para **Awin (completo, com credencial
nova)** e **AliExpress (parcial, por amostragem de produtos)**. O resto depende de outras
fontes, descritas a seguir.

## 2. Fontes de cupons ("busca automática")

Todo cupom tem uma **origem** (`CouponOrigin`):

| Origem | Como entra | Automático? |
|---|---|---|
| `API` | Job periódico `coupon-sync` (AliExpress + Awin) e botão "Buscar cupons agora" | Sim |
| `EXTENSION` | A extensão detecta o código na página do produto/loja durante a navegação normal do usuário e envia para a API | Semi (passivo) |
| `IMPORT` | O usuário cola um texto livre (mensagem de grupo de cupons, e-mail, post) e o parser extrai código, loja, desconto e validade para revisão antes de salvar | Não (assistido) |
| `MANUAL` | Formulário "Novo cupom" | Não |
| `MIRROR` *(opcional — §7)* | Mensagens que chegam nos grupos de origem do espelhamento passam pelo mesmo parser | Sim |

### Job `coupon-sync`

Mesmo padrão do `awin-import`: fila BullMQ `coupon-sync` (`QUEUE_COUPON_SYNC`), um processor
no worker e um `CouponSyncScheduler` com `setInterval` mais um tick inicial. O intervalo vem de
`COUPON_SYNC_INTERVAL_HOURS` (padrão 6h), e um valor inválido cai no padrão, com a mesma
proteção do `AwinImportScheduler`. O tick enfileira um job por tenant que tenha AliExpress ou
Awin (com credencial de Offers) configurado. O job também roda a **varredura de expiração** do
tenant.

Por fonte:

- **Awin:** lista todas as páginas com `type=voucher`, `membership=joined`,
  `regionCodes=['BR']` e `status=active`. Ignora ofertas com `voucher.code` nulo. Faz upsert por
  `(tenantId, store=AWIN, code, scope=advertiser.id)`. Como a listagem "active" é exaustiva, um
  cupom `origin=API, store=AWIN` que **não voltou** numa sincronização bem-sucedida vira
  `EXPIRED` (a verificação registra o motivo "sumiu da fonte").
- **AliExpress:** varre até N páginas (padrão 5 × 50) de `hotproduct.query` em BRL/PT/BR. Se o
  tenant tiver keywords de regras de automação com AliExpress, usa também
  `product.query` com essas keywords. Coleta os produtos com `promo_code_info.promo_code`
  preenchido e faz upsert por `(tenantId, ALIEXPRESS, code, scope='')`. Como a amostragem **não é
  exaustiva**, um cupom ausente numa rodada **não** é expirado. Ele só expira por
  `code_availabletime_end` ou por `code_quantity = 0`, que marca `INVALID` com o motivo
  "esgotado".
- **Upsert não rebaixa status verificado:** se o cupom já está `VALID` ou `INVALID` por
  verificação humana, o sync só atualiza metadados (validade, descrição, `lastSeenAt`) e mantém o
  status. A exceção é a expiração pela data.

### Resultado exposto

O job devolve `{ source, ok, created, updated, expired, error? }[]`. O botão "Buscar cupons
agora" aguarda até 45s com `waitUntilFinished`, como no import da Awin, e cai para
`{ queued: true }` se passar disso. Ao terminar, o worker publica o evento
`{ type: 'coupons.updated' }`.

## 3. Cupom manual

Fica na própria página `config/cupons`, no lugar do placeholder.

**Diálogo "Novo cupom"** (também usado para editar):

| Campo | Obrigatório | Observação |
|---|---|---|
| Loja | sim | select de `MarketplaceKind` |
| Anunciante | não | texto livre, útil para Awin (a loja real dentro da rede) |
| Código | sim | normalizado com trim + maiúsculas |
| Descrição | sim | ex.: "R$ 20 off acima de R$ 150 em eletrônicos" |
| Tipo de desconto | não | Percentual / Valor fixo / Frete grátis |
| Valor do desconto | não | número (% ou R$, conforme o tipo) |
| Compra mínima | não | R$ |
| Início / Validade | não | datas |
| Link | não | `sourceUrl`, a página da oferta ou link de afiliado |
| Observações | não | regras, categorias etc. (vai em `terms`) |

**Diálogo "Colar texto"**: um textarea recebe o texto livre. `POST /coupons/parse` devolve os
candidatos extraídos, cada um com loja detectada, código, desconto e validade. O usuário revisa,
corrige e desmarca na tabela, e `POST /coupons/bulk` salva os escolhidos com `origin=IMPORT`.

O cupom duplicado (mesmo `tenantId, store, code, scope`) devolve 409 no cadastro individual e
aparece como "já existe" (pulado) no bulk.

## 4. Validação

Status (`CouponStatus`): `UNVERIFIED` (padrão), `VALID`, `INVALID` e `EXPIRED`, mais
`lastVerifiedAt`. Cada verificação gera uma linha em `CouponCheck`
(`result`, `method: MANUAL | EXTENSION | SOURCE | EXPIRY`, `note`, `createdAt`) para dar
histórico ("funcionou em 20/09, falhou em 24/09").

A automação deixa de disparar cupons `INVALID` e `EXPIRED` (`isEligibleCoupon` ganha `status`).
`UNVERIFIED` e `VALID` continuam elegíveis. A opção "só disparar cupons validados" por regra
ficou fora de escopo; veja as decisões em aberto.

Níveis de validação, do mais seguro ao mais arriscado:

| Nível | Como funciona | Prós | Contras / riscos |
|---|---|---|---|
| **0. Automática por metadados** | Varredura: `expiresAt < agora` → `EXPIRED` (method `EXPIRY`). Awin sumiu da listagem ativa → `EXPIRED` (`SOURCE`). AliExpress `code_quantity=0` → `INVALID` (`SOURCE`). | Zero risco e zero ToS; roda no job. | Não detecta cupom "vivo na data mas que não aplica" (esgotado, restrito a categoria, só para primeira compra). |
| **1. Manual** | Botões "Funcionou" / "Não funcionou" no card, com nota opcional. | Simples e sem risco. | Depende de o usuário testar por conta própria. |
| **2. Assistida pela extensão** (recomendado como teto) | No **carrinho/checkout da loja, na sessão logada do próprio usuário**, a extensão mostra um painel "Cupons Afilados para esta loja". "Testar" preenche o campo de cupom e clica em aplicar (ação iniciada pelo usuário, como o Honey faz), observa a mensagem de sucesso/erro com seletores por loja, **pré-marca** o resultado e o usuário confirma com um clique. Depois disso, `POST /extension/coupons/:id/verification` com method `EXTENSION`. | Teste real no checkout real, sem robô no servidor e sem credencial do usuário no backend. A confirmação humana absorve os falsos positivos de seletor quebrado. | Seletores por loja quebram quando o site muda (manutenção contínua). Exige item no carrinho que atinja a compra mínima. Cada loja tem um fluxo diferente: Shopee aplica voucher no app, e o ML muda o fluxo. Risco de ToS **baixo a moderado**: é ação do usuário na própria sessão, mas preencher e clicar automaticamente num checkout é zona cinzenta em termos de uso. |
| **2b. Variante sem auto-clique** | Igual ao nível 2, mas a extensão só **copia o código e destaca o campo**; o usuário cola, clica em aplicar e responde "funcionou?". | Praticamente sem risco de ToS; não depende de seletor de resultado. | Mais cliques por teste. |
| **3. Checkout automatizado no servidor** (headless) | Worker loga numa conta do usuário, monta carrinho e aplica os códigos em lote. | Validação 100% automática em massa. | Exige guardar a credencial da conta de compra. Anti-bot (captcha, device fingerprint) derruba com frequência. Viola explicitamente os termos das lojas, com **risco de banir a conta de compra e até a de afiliado**. Custo alto de manutenção. **Não incluído no plano.** |

## 5. Mudanças de schema

```prisma
enum CouponOrigin { MANUAL API EXTENSION IMPORT MIRROR }
enum CouponStatus { UNVERIFIED VALID INVALID EXPIRED }
enum CouponDiscountType { PERCENT FIXED FREE_SHIPPING }
enum CouponCheckMethod { MANUAL EXTENSION SOURCE EXPIRY }

model Coupon {
  id             String              @id @default(cuid())
  tenantId       String
  tenant         Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  store          MarketplaceKind
  /// Escopo da unicidade dentro da loja: advertiser.id na Awin, '' nas demais.
  scope          String              @default("")
  advertiserName String?
  code           String
  description    String
  terms          String?
  discountType   CouponDiscountType?
  discountValue  Decimal?            @db.Decimal(10, 2)
  minSpend       Decimal?            @db.Decimal(10, 2)
  startsAt       DateTime?
  expiresAt      DateTime?
  sourceUrl      String?
  /// Link de afiliado com o cupom já aplicado (AliExpress code_promotionurl, Awin urlTracking).
  affiliateUrl   String?
  /// ID na fonte (Awin promotionId, AliExpress product_id de onde o código veio).
  externalId     String?
  remainingUses  Int?
  origin         CouponOrigin        @default(MANUAL)
  status         CouponStatus        @default(UNVERIFIED)
  lastVerifiedAt DateTime?
  /// Última vez que uma fonte automática devolveu este cupom.
  lastSeenAt     DateTime?
  fetchedAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  automationQueueItems AutomationQueueItem[]
  batchItems     BatchItem[]
  checks         CouponCheck[]

  @@unique([tenantId, store, code, scope])
  @@index([tenantId, status, expiresAt])
}

model CouponCheck {
  id        String            @id @default(cuid())
  tenantId  String
  tenant    Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  couponId  String
  coupon    Coupon            @relation(fields: [couponId], references: [id], onDelete: Cascade)
  result    CouponStatus      // VALID | INVALID | EXPIRED
  method    CouponCheckMethod
  note      String?
  createdAt DateTime          @default(now())

  @@index([couponId, createdAt])
}
```

Migração: as linhas existentes ficam com `scope=''`, `origin=MANUAL` e `status=UNVERIFIED`. O
`@@unique` antigo `[tenantId, store, code]` é trocado pelo novo com `scope`, o que não conflita
com os dados atuais porque todos ficam com `scope=''`. `updatedAt` precisa de default no SQL da
migração (`DEFAULT now()`) por causa das linhas existentes.

Credenciais Awin: `AwinCredentials` ganha `publisherId?: string` e `offersApiToken?: string`,
ambos opcionais. Sem eles, o sync só pula a Awin; o datafeed segue igual.

## 6. API

Arquivo novo `apps/api/src/routes/coupons.ts` (`requireAuth`, `req.db` por tenant):

| Método | Rota | O que faz |
|---|---|---|
| GET | `/coupons?store&status&origin&q&includeExpired` | Lista, ordenada por status (VALID > UNVERIFIED > INVALID > EXPIRED) e depois por validade mais próxima. Por padrão esconde `EXPIRED`. |
| POST | `/coupons` | Cria manual (`origin=MANUAL`). 409 se duplicado. |
| PUT | `/coupons/:id` | Edita os campos do formulário (não mexe em status/origem). |
| DELETE | `/coupons/:id` | Remove. Se houver `BatchItem` referenciando, devolve 409 ("cupom já usado em envios — marque como expirado"). Itens de fila `AutomationQueueItem` caem em cascata (já é o comportamento da relação). |
| POST | `/coupons/parse` | `{ text, store? }` → `{ candidates: CouponCandidate[] }` (não grava nada). |
| POST | `/coupons/bulk` | `{ coupons: CouponInput[], origin: 'IMPORT' }` → `{ created, skipped }`. |
| POST | `/coupons/sync` | Enfileira `coupon-sync` do tenant e aguarda até 45s (mesmo padrão de `/marketplaces/awin/import`). |
| POST | `/coupons/:id/verify` | `{ result: 'VALID' \| 'INVALID', note? }`, method `MANUAL`: cria `CouponCheck`, atualiza `status` e `lastVerifiedAt`. |
| GET | `/coupons/:id/checks` | Histórico de verificações. |

Na extensão (`apps/api/src/routes/extension.ts`, auth por token de API já existente):

| Método | Rota | O que faz |
|---|---|---|
| GET | `/extension/coupons?store=` | Cupons não `INVALID`/`EXPIRED` da loja, para o painel do carrinho. |
| POST | `/extension/coupons` | Captura um código visto na página: upsert com `origin=EXTENSION`, sem rebaixar o status. |
| POST | `/extension/coupons/:id/verification` | `{ result, note? }`, method `EXTENSION`. |

`POST /extension/capture` também passa a fazer upsert de `Coupon` (`origin=EXTENSION`) quando
vier `couponCode` real. O valor fixo `'CUPOM AMAZON'` deixa de existir: a Amazon passa a mandar
só `couponValue` (cupom de clipar).

Evento de tempo real aditivo: `{ type: 'coupons.updated' }`, publicado após o sync, o CRUD e as
verificações. O `realtime.tsx` invalida `['coupons']` quando recebe o evento.

## 7. Colheita de cupons dos grupos espelhados (opcional — decisão do usuário)

O `mirror-message` já recebe as mensagens dos grupos de origem configurados. Um hook chamaria
`parseCouponsFromText` em cada mensagem e faria upsert dos candidatos com `origin=MIRROR` e
`status=UNVERIFIED`. É barato porque reaproveita o parser da §3 e é a fonte "automática" mais
rica para ML, Magalu, Amazon e Shopee, que não têm API. Riscos: ruído (códigos falsos
positivos) e a questão de conteúdo de terceiros, já presente no espelhamento. Fica como a última
task do plano, **só executada se o usuário aprovar**.

## Fora de escopo

- Validação por checkout automatizado no servidor (nível 3).
- Raspar sites agregadores de cupons de terceiros (Cuponomia, Pelando, Méliuz etc.): termos de
  uso e direitos sobre o conteúdo. Fica listado como decisão em aberto.
- Raspagem server-side das páginas oficiais de cupons do ML e da Magalu. Elas exigem login,
  mostram cupons pessoais e têm anti-bot. Pode voltar se o spike mostrar uma página pública
  estável.
- Opção por regra de automação "só cupons validados".

## Decisões em aberto (para o usuário)

1. **Teto da validação:** nível 2 (auto-preencher e clicar em aplicar, com confirmação) ou 2b
   (só copiar e destacar)? O plano implementa 2b como base, e o 2 fica atrás de um flag por
   loja, ligado só depois de o usuário aprovar.
2. **Colheita dos grupos espelhados (§7):** sim ou não?
3. **Awin:** o usuário tem (ou quer gerar) o token da API de publisher e o Publisher ID?
4. **Automação só com cupons `VALID`?** Hoje o plano bloqueia só `INVALID` e `EXPIRED`.

## Testes

- **core:** `parseCouponsFromText` com mensagens reais de grupos (vários formatos: "CUPOM:
  X", "use o código X", emoji, várias lojas numa mensagem, validade "até 30/09",
  "R$ 20 OFF acima de R$ 150", "15% OFF"). `isEligibleCoupon` com status.
- **marketplaces:** mapper `promo_code_info` → `CouponUpsertInput` (tipos 1 e 2, datas, código
  vazio ignorado); mapper Awin offer → input (voucher nulo ignorado, advertiser vira scope);
  client Awin com `fetch` mockado (paginação, 401 → `AWIN_UNAUTHORIZED`).
- **worker:** `coupon-sync` cria, atualiza e não rebaixa `VALID`; expira Awin ausente; não
  expira AliExpress ausente; varredura por data gera `CouponCheck` `EXPIRY`; scheduler com
  intervalo inválido cai no padrão.
- **api:** CRUD com isolamento de tenant, 409 duplicado, 409 no delete com `BatchItem`,
  `verify` cria check e atualiza status, `parse` não grava, `bulk` pula duplicados, rotas da
  extensão.
- **web:** página renderiza a lista, os filtros, o diálogo novo/editar e o fluxo colar →
  revisar → salvar.

## Migração e compatibilidade

Todos os campos novos têm default ou são opcionais, e `POST /automations/:id/queue/coupon`
continua funcionando (cria com `origin=MANUAL`). O único ponto que exige cuidado é a troca do
`@@unique`: a migração precisa dropar o índice antigo e criar o novo.
