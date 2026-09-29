# Design: Dados de produto do Mercado Livre via API oficial

**Data:** 2026-09-29
**Status:** Aprovado pelo dono (uso próprio, não SaaS) — condicionado à validação dos dados, feita em 2026-09-29

## Contexto

A captura de produtos do Mercado Livre por raspagem de HTML no servidor (`scrapers/mercadolivre.ts`,
`scrapers/discovery.ts`) é bloqueada pelo anti-bot: a busca devolve uma página de verificação com
HTTP 200 e a descoberta por palavra-chave fica vazia. A extensão contorna isso lendo a página no
navegador do usuário, mas só funciona com o Chrome aberto.

O dono criou um app no DevCenter do Mercado Livre e autorizou-o com a própria conta. Esta rodada usa
a API oficial para preencher título, foto e preço de um produto a partir do link, e para descobrir
produtos por palavra-chave, sem raspagem.

## Investigação (feita contra a API real com o app do dono)

Sonda: `scripts/ml-api-probe.mjs` (OAuth `authorization_code` + PKCE, redirect
`https://<DOMAIN>/callbackml`). Resultados:

| Recurso | Resultado |
|---|---|
| `GET /products/search?status=active&site_id=MLB&q=` | 200. Devolve produtos de **catálogo** (nome, `pictures`, `parent_id`, `catalog_product_id`), sem preço |
| `GET /products/{id}` | 200. `permalink` vem **vazio**; `buy_box_winner` **nulo**; `buy_box_activation_date` nulo; todos `pdp_types: ["traditional"]` |
| `GET /products/{id}/items` | 200 com `results[]` (ofertas: `item_id`, `seller_id`, `price`, `condition`, `inventory_id`, `deal_ids`, `tags`…). **404 "No winners found"** quando o produto não tem oferta ativa |
| `GET /items/{id}` e `/items/{id}/sale_price` | **403** — anúncios de outros vendedores não são acessíveis a este app |
| `GET /sites/MLB/search` | **403** (busca de anúncios fechada) |
| `GET /user-products/{id}` | 403 |

Validação contra as páginas reais (capturas do dono):

- `MLB62010143`: API `#1 R$ 44,55` (ofertas: 44,55 / 27,00 / 29,90…). A página mostra **R$ 44,55 riscado
  e R$ 35,64 "20% OFF no Pix"** (44,55 × 0,8 = 35,64). Conclusão: a **primeira oferta da API é a principal**
  da página (não a mais barata) e o `price` da API é o **preço de lista**, sem o desconto do Pix.
- `MLB22239330`: página lista 4 lojas — R$ 35, 80, 94,90, 159,90 — exatamente as 4 ofertas da API, na
  mesma ordem.
- `MLB68059006`: página "produto indisponível" = 404 da API. Produtos sem oferta são só indisponíveis
  (a hipótese de "variação de cor sem preço" foi descartada: o pai também não tem oferta).

## O que a API **não** dá (limitações assumidas)

- **Preço original / desconto**: `buy_box_winner` é nulo para este app e `deal_ids` veio 0 em todas as ofertas.
  O `price` é o preço de lista; descontos de Pix/cupom/cartão da página **não** estão nele. O filtro
  de desconto mínimo das automações não é aplicável a itens vindos da API.
- **Link de anúncio individual** (`produto.mercadolivre.com.br/MLB-…`): depende de `/items/{id}` (403). Só
  links de **catálogo** (`…/p/MLB…`) resolvem. Se a URL trouxer `wid=MLB…` (ID da oferta), usamos a oferta
  correspondente; sem `wid`, a primeira oferta.
- `permalink` vem vazio: a URL do produto é montada (`https://www.mercadolivre.com.br/p/<id>`) ou é a URL original.
- Frete: as ofertas não trazem `shipping`. `inventory_id` preenchido indica Full → `FULL`; senão `UNKNOWN`.

## Termos de uso (lidos em 2026-09-29)

Riscos conhecidos e aceitos pelo dono para uso próprio: cláusulas 5.2/7.2 (Conteúdo do ML só dentro do
Aplicativo), 2(f) (não divulgar a quem não é usuário), 5.3 (atualizar listagens a cada 6 h), 2.2.1.3 (cópias
temporárias), 2.2.3/7.8 (limites e volume razoável). O acesso pode ser revogado a qualquer momento
(cláusula 14). Este design **não** guarda histórico de preços e respeita espera/backoff nas chamadas.

## Decisões de design

### 1. Credenciais

- `ML_CLIENT_ID` e `ML_CLIENT_SECRET` ficam no `.env` (app único do dono; não vão ao banco nem ao navegador).
- `redirect_uri`: `DESENVOLVIMENTO=true` → `http://localhost:3000/callback`; caso contrário
  `https://<DOMAIN>/callbackml`. (O DevCenter só aceita o que estiver cadastrado exatamente igual.)
- `TagCredentials.mlApi?: { refreshToken: string; accessToken?: string; expiresAt?: string; userId?: string; connectedAt?: string }`,
  gravado criptografado na `MarketplaceConnection` do Mercado Livre, junto do resto das credenciais.

### 2. OAuth dentro do app

- `POST /marketplaces/mercadolivre/oauth/start` (autenticado): gera `state` + PKCE, guarda `{tenantId, verifier}` no
  Redis (`ml-oauth:<state>`, TTL 10 min) e devolve a URL de autorização.
- `POST /marketplaces/mercadolivre/oauth/callback` `{ code, state }` (autenticado): consome o `state`, confere o
  tenant, troca o código por token e grava `mlApi`.
- `/callbackml` (página pública do web) lê `code`/`state` da URL e chama o endpoint acima com a sessão do painel.
  Sem sessão, mostra o aviso de entrar no painel e repetir.

### 3. Token

- Access token dura 6 h; o `refresh_token` é **de uso único** (cada renovação devolve um novo). Por isso a
  renovação **grava o novo `refreshToken` antes de devolver o access token**, sob lock no Redis
  (`ml-api-refresh:<tenantId>`), porque API e worker podem renovar ao mesmo tempo.
- A lógica pura (`buildMlAuthUrl`, `generatePkce`, `exchangeMlCode`, `refreshMlToken`, `ensureMlAccessToken`)
  fica em `packages/marketplaces/src/mercadolivre/api-token.ts`, com `save` injetado; o vínculo com banco e
  lock fica em `lib/ml-api.ts` de cada app (mesma duplicação que `loadTagCredentials` já tem).

### 4. Cliente e mapeamento (`packages/marketplaces/src/mercadolivre/api.ts`)

- `extractMlCatalogRef(url)` → `{ productId, offerId? }` para `…/p/MLB…` (com `wid=` na query ou no fragmento).
- `mlApiGet` com backoff exponencial em 429 (até 3 tentativas) e uma nova tentativa em 5xx; 401/403 → `MlApiError`
  `ML_API_UNAUTHORIZED`; 404 → `ML_API_NOT_FOUND`.
- `fetchCatalogProduct`, `fetchProductOffers` (404 → `[]`), `searchCatalogProducts`.
- `mapMlCatalogProduct(product, offers, url, offerId?)` → `ProductData | undefined` (`undefined` se não há oferta
  utilizável). Oferta escolhida: a de `item_id === offerId`; senão a primeira `condition: 'new'`; senão a primeira.

### 5. Integração

- `tag-adapter.ts`: `MERCADOLIVRE.fetchByUrls` usa a API para URLs de catálogo quando `creds.mlApi?.accessToken`
  existe; URLs que a API não resolve (anúncio individual) e a ausência de `mlApi` **mantêm** o comportamento atual.
- Carregadores de credenciais (API e worker) renovam o token e injetam `mlApi.accessToken` para o ML.
- Descoberta por palavra-chave (worker): com `mlApi`, busca no catálogo, resolve as ofertas de cada produto
  (espaçando as chamadas) e descarta produtos sem oferta; sem `mlApi`, mantém o caminho atual.
- `publicConnection` expõe `mlApiConnectedAt` (nunca tokens). Card do ML na tela de marketplaces ganha o botão
  "Conectar API oficial".

## Fora de escopo

- Preço original/desconto do ML (não disponível), histórico de preços (termos), `sale_price`/`items` (403),
  tendências (`/trends` devolveu termos sem sentido), `/highlights` (mais vendidos por categoria — fica para depois).
- Multi-tenant/SaaS: uma única conta autorizada, credenciais globais no `.env`.

## Riscos assumidos

- A escolha "primeira oferta = oferta principal" foi validada em **um** produto com várias ofertas; nos outros
  a primeira coincide com a mais barata. Se a página divergir, ajustar em `mapMlCatalogProduct`.
- O `price` é de lista: a mensagem enviada pode mostrar um valor maior que o da página (que aplica Pix/cupom).
- Limites de requisição (429) não são publicados; o cliente faz backoff e a descoberta espaça as chamadas.

## Testes

- `api.test.ts`: `extractMlCatalogRef` (com/sem `wid`, query e fragmento), backoff em 429, 401/403/404,
  `mapMlCatalogProduct` (oferta por `wid`, primeira nova, sem oferta, sem imagem, `inventory_id` → FULL).
- `api-token.test.ts`: URL de autorização com PKCE, troca de código, renovação que grava o novo refresh antes de
  devolver, reaproveitamento do access token válido.
- Rotas OAuth da API (start/callback com `fetch` simulado, `state` inválido/expirado, tenant diferente).
- `tag-adapter.test.ts`: ML por API, fallback para raspagem sem `mlApi` e para URL de anúncio individual.
