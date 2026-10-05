# Design: Ofertas do Mercado Livre por listagem + links de afiliado em lote

**Data:** 2026-10-05
**Status:** Aprovado pelo dono em conversa (seções 1–3 + ajuste de fallback do link)
**Origem:** análise do workflow n8n "BUSCA DE PRODUTOS MERCADO LIVRE - V3"

## Contexto

A busca de produtos do Mercado Livre por palavra-chave (`lista.mercadolivre.com.br/<termo>`) é bloqueada
pelo anti-bot (redireciona para `/gz/account-verification`). A API oficial
([2026-09-29](2026-09-29-mercadolivre-api-oficial-design.md)) funciona, mas não traz preço original nem
desconto.

O workflow n8n analisado contorna os dois problemas de outro jeito: em vez de buscar por palavra-chave,
raspa **páginas de listagem de ofertas** e extrai tudo dos cards da listagem. Também gera links de
afiliado **em lote** (até 20 URLs por chamada ao `createLink`, com a etiqueta do afiliado).

### Sonda (2026-10-05, fetch anônimo, IP residencial)

| URL | Resultado |
|---|---|
| `www.mercadolivre.com.br/ofertas` | 200, 48 cards `poly-card`, preço riscado e "% OFF" em todos |
| `/ofertas?page=2` | 200, 48 cards |
| `/ofertas?category=MLB1051` / `MLB1574` | 200, filtra de verdade (celulares / casa) |
| `/ofertas?promotion_type=lightning` | 200, cards com `poly-component__highlight-countdown` |
| `/mais-vendidos` | 200, cards `poly-card` |
| `lista.mercadolivre.com.br/fone-bluetooth` | Redireciona para `/gz/account-verification` (bloqueado) |
| `api.mercadolibre.com/sites/MLB/categories` | 403 (PolicyAgent) |

Seletores observados nos cards (o código do workflow já está parcialmente desatualizado: o desconto não
usa mais `poly-price__disc_label`):

- título e link: `a.poly-component__title` (`href` com query/fragmento de tracking; `wid=MLB…` no fragmento em links de catálogo)
- imagem: `img.poly-component__picture` (`src` ou `data-src`)
- preço atual: `.poly-price__current .andes-money-amount__fraction` / `__cents`
- preço original: `s.andes-money-amount--previous`
- desconto: `.poly-price__discount-polylabel` ("72% OFF")
- frete/Full: `.poly-component__shipping-v2`, `.poly-bookmark__icon-full`
- relâmpago: `.poly-highlight-countdown__text`
- link patrocinado a descartar: `click1.mercadolivre`

## Escopo

**Entra:**
1. Busca **manual** de ofertas do ML na tela Buscar Produtos (nova subaba "Ofertas do ML"), com quatro
   fontes: Ofertas do dia, Ofertas por categoria, Ofertas relâmpago, Colar URL de listagem.
2. Geração de link de afiliado meli.la **em lote**, com etiqueta configurável, cache no Redis,
   pré-aquecimento ao salvar na fila/lote e fallback para o método atual.

**Fora de escopo:** fontes de listagem nas automações, histórico de preços, envio automático para grupos
(o sistema já cobre com lotes), lista de categorias dinâmica (a API pública responde 403).

## Seção 1: Busca nas listagens

### `packages/marketplaces/src/mercadolivre/listing.ts` (novo)

- `type MlListingSource = { kind: 'deals' } | { kind: 'category'; categoryId: string } | { kind: 'lightning' } | { kind: 'url'; url: string }`
- `buildMlListingUrl(source, page)`:
  - deals → `https://www.mercadolivre.com.br/ofertas?page=N`
  - category → `…/ofertas?category=<id>&page=N` (`id` validado com `/^MLB\d+$/`)
  - lightning → `…/ofertas?promotion_type=lightning&page=N`
  - url → a URL colada, aceita só `https:` com host `mercadolivre.com.br` ou `*.mercadolivre.com.br`
    (proteção contra SSRF). Paginação: substitui/adiciona `page=N` na query.
- `parseMlListingHtml(html): ProductData[]` com cheerio:
  - Formato principal: cards `poly-card` (seletores acima). Formato secundário: `dynamic-carousel__item-container`
    (algumas páginas coladas usam esse layout).
  - Para cada card: `title`, `images: [imagem]`, `price`, `originalPrice` (descartado se ≤ preço atual),
    `discountPct` (do rótulo; senão calculado), `shipping` (`FULL` se ícone Full, `FREE` se "grátis", senão
    `UNKNOWN`), `flashSaleEndsAt` (da contagem regressiva "HH:MM:SS" somada a agora, quando houver),
    `externalId` (`MLB-?\d+` normalizado sem hífen, maiúsculo), `source: 'MERCADOLIVRE'`.
  - `originalUrl`: sem query nem fragmento de tracking; quando o link é de catálogo (`/p/MLB…`) e trouxer
    `wid=MLB…`, preserva `#wid=<id>` (a API oficial usa o `wid` para escolher a oferta, ver `extractMlCatalogRef`).
  - Descarta cards sem título, sem preço ou sem link, e links `click1.mercadolivre`.
  - Deduplica por `externalId`.
- `isMlVerificationPage(finalUrl, html)`: verdadeiro se a URL final contém `/gz/account-verification` ou o
  HTML não tem cards e contém a marca da página de verificação.
- `fetchMlListing(source, { limit, cookies?, fetchImpl?, sleep? })`:
  - Busca páginas sequenciais (48 cards cada) até `limit` produtos válidos ou **no máximo 5 páginas**, com
    pausa aleatória de **1–2 s** entre páginas.
  - Primeira tentativa de cada página é anônima. Se cair na verificação **e** houver `cookies`, repete a
    mesma página com o header `Cookie` (mesmo `cookieHeader` do `official-link.ts`).
  - Erros (`MlListingError` com `code`):
    - `ML_LISTING_BLOCKED`: verificação na página 1 sem cookies, ou mesmo com cookies.
    - `ML_LISTING_LAYOUT`: página 1 com HTML normal, mas zero cards reconhecidos (layout mudou). Loga URL e tamanho do HTML.
    - `ML_LISTING_INVALID_URL`: URL colada fora do domínio permitido.
  - Falha na página 2 ou seguinte: interrompe e devolve o que já coletou.
  - Usa o `fetch` com User-Agent de navegador e `Accept-Language: pt-BR` (mesmos headers do `fetcher.ts`) e
    `redirect: 'follow'` para conseguir ver a URL final.

### Categorias

Lista estática `ML_DEAL_CATEGORIES: { id: string; label: string }[]` com as categorias raiz do MLB em
`packages/shared/src/marketplaces.ts` (ex.: `MLB1051` Celulares e Telefones, `MLB1574` Casa, Móveis e
Decoração, `MLB1648` Informática, `MLB1000` Eletrônicos, Áudio e Vídeo…). A lista é conferida durante a
implementação abrindo `/ofertas?category=<id>` de cada uma.

### Shared

- `SEARCH_MODES` ganha `'listing'`.
- `searchQuerySchema` ganha `mlListing?: { kind: 'deals' | 'category' | 'lightning' | 'url'; categoryId?: string; url?: string }`,
  com `superRefine`: `mode === 'listing'` exige `source === 'MERCADOLIVRE'` e `mlListing`; `category` exige
  `categoryId`; `url` exige `url`.

### API (`apps/api/src/routes/products.ts`)

`POST /products/search` com `source=MERCADOLIVRE` e `mode=listing`:
1. Carrega `TagCredentials` do ML (para `mlSession.cookies`, se houver).
2. `fetchMlListing(source, { limit: q.limit, cookies })`.
3. Aplica no servidor os filtros que o formulário já envia: `minDiscountPct`, `minPrice`, `maxPrice`,
   `freeShippingOnly`.
4. Faz upsert em `Product` como as outras fontes de busca e devolve `{ products: ApiProduct[] }`.
5. Mapeia `MlListingError` para resposta: `ML_LISTING_BLOCKED` → 502 com "O Mercado Livre bloqueou a
   listagem. Sincronize a sessão pela extensão Afilados Connect" (e "a sessão pode ter expirado" quando
   havia cookies); `ML_LISTING_LAYOUT` → 502 "A página de ofertas do ML mudou de layout; avise o suporte";
   `ML_LISTING_INVALID_URL` → 400.

### Web

- `produtos/page.tsx`: nova subaba `{ key: 'listing', label: 'Ofertas do ML', sources: ['MERCADOLIVRE'] }`.
  Ela fica habilitada mesmo sem API oficial (não depende de `mlApiConnected`).
- `search-filters.tsx`, com `mode === 'listing'`: select "Fonte" (Ofertas do dia / Categoria / Relâmpago /
  Colar URL). Categoria mostra um select com `ML_DEAL_CATEGORIES`; Colar URL mostra um input. Mantém Qtd.
  (20/50/100/200), preço mín./máx., desconto mín. e "só frete grátis". Esconde "Ordenar" (a ordem é a da
  página do ML).
- O resultado entra no grid atual, com "Salvar selecionados" para a fila.

## Seção 2: Links de afiliado em lote

### Gerador (`packages/marketplaces/src/mercadolivre/official-link.ts`)

- `generateOfficialMlLinks(urls, cookies, { tag?, endpoint?, timeoutMs?, fetchImpl? }): Promise<Map<string, string>>`
  (**método 1**):
  - Abre o painel uma vez (valida sessão, extrai CSRF), depois chama `createLink` em lotes de **20 URLs** com
    corpo `{ urls: [...], tag: tag ?? '' }`.
  - Mapeia a resposta `urls[].origin_url → short_url` (só aceita `short_url` meli.la). Se o formato não
    tiver `urls[]`, tenta `findMeliLink` apenas quando o lote tem 1 URL.
  - Sessão expirada (login/401/403) → `MlSessionError('ML_SESSION_EXPIRED')`. Outros erros de lote →
    `MlBatchLinkError` com a mensagem e as URLs afetadas.
- `generateOfficialMlLink` (**método 2**, o atual) continua igual, mas passa a enviar `tag` também.

### Etiqueta

`TagCredentials.tag` passa a ser usado pelo ML (hoje só Amazon/Magalu usam) e é enviado no `createLink`.
Vazio = etiqueta padrão da conta. O drawer do ML em Marketplaces ganha o campo opcional "Etiqueta de
afiliado", com a dica "Central de afiliados → Administrar etiquetas". Não entra em `requiredTagFields`.

### Cache no Redis

Chave `ml-aff-link:<tenantId>:<tag|default>:<urlLimpa>` com TTL de **24 h**, compartilhada entre API e
worker. O `toAffiliateLink` do ML consulta esse cache antes de gerar (o cache em memória atual continua
como primeiro nível). O adapter recebe as funções de cache por injeção (`opts.linkCache`), para o pacote
`marketplaces` não depender do Redis.

### Pré-aquecimento

- Ao salvar produtos na fila (`POST /queue`) e ao trazê-los para um lote (`POST /batches/:id/send-products`),
  a API enfileira o job `ml-links-prewarm { tenantId, urls }` com as URLs dos produtos do ML que ainda não
  estão no cache.
- O job no worker, para cada lote de 20 URLs:
  1. Tenta o **método 1**.
  2. Se o método 1 lançar `MlBatchLinkError` (HTTP de erro, resposta sem `urls[]`, timeout) **ou** voltar
     sem `short_url` para alguma URL, essas URLs passam pelo **método 2**, uma por vez, com 1 s de pausa.
  3. `ML_SESSION_EXPIRED` não aciona o método 2 (falharia pelo mesmo motivo): o job termina e o envio
     segue o caminho atual.
  4. Grava no cache todos os links obtidos. Pausa de 2–3 s entre lotes.
- Se o pré-aquecimento falhar ou não rodar, o envio segue o caminho atual: método 2 na hora e, se falhar,
  fallback `matt_word`/`matt_tool`. Nada piora em relação a hoje.

### Registro e exibição do erro do método 1

- Toda falha do método 1 grava `ml-links-batch:last-error:<tenantId>` no Redis (sem TTL) com
  `{ at, message, urls: <qtd>, recoveredByFallback: <qtd salva pelo método 2> }` e loga no worker.
- Um lote do método 1 que funcione por completo apaga a chave.
- `GET /marketplaces` expõe essa informação no ML como `mlLinkBatchError?: { at, message, urls, recoveredByFallback }`
  (nunca tokens).
- O card do ML na tela Marketplaces mostra um aviso amarelo persistente enquanto houver erro:
  "Gerador de links em lote falhou em 05/10 14:32: <mensagem>. N de M links gerados pelo método
  individual." O aviso some quando um lote volta a funcionar.

## Seção 3: Testes e validação

- `listing.test.ts`, com fixtures de HTML real em `packages/marketplaces/test/fixtures/ml-listing-*.html`
  (ofertas, categoria, relâmpago, carrossel e página de verificação):
  - preços com e sem centavos, preço original e % OFF;
  - Full e frete grátis;
  - contagem regressiva do relâmpago → `flashSaleEndsAt`;
  - descarte de `click1`, URL limpa com `#wid` preservado, deduplicação;
  - página de verificação detectada;
  - `buildMlListingUrl` para as quatro fontes e o bloqueio de domínio;
  - `fetchMlListing`: paginação até o limite, teto de 5 páginas, retentativa com cookies, erros
    `BLOCKED`/`LAYOUT`, falha na página 2 devolvendo a página 1.
- `ml-official-link.test.ts`: 45 URLs viram 3 chamadas de `createLink` com uma abertura do painel;
  mapeamento `origin_url → short_url`; URL ausente na resposta; `tag` enviado; sessão expirada.
- API: `/products/search` com `mode=listing` (fetch simulado), filtros de desconto, preço e frete, e o
  mapeamento de erros; schema rejeita `listing` fora do ML.
- Worker: `ml-links-prewarm` grava no cache; falha do método 1 aciona o método 2 e grava `last-error`;
  sessão expirada não aciona o método 2; lote bem-sucedido apaga `last-error`.
- Tag adapter: `toAffiliateLink` lê do cache do Redis antes de gerar.
- Web: a subaba "Ofertas do ML" aparece só para o ML; o select de fonte mostra e esconde categoria e URL;
  o card do ML mostra e esconde o aviso de erro do lote.
- **Validação final no Docker:** busca real nas quatro fontes pela tela, salvar na fila, conferir links em
  lote com a sessão do dono e simular falha do método 1 (endpoint inválido via `ML_LINKBUILDER_ENDPOINT`)
  para ver o fallback e o aviso no card.

## Riscos assumidos

- A sonda saiu de IP residencial; o IP da VPS pode ser tratado de outro jeito pelo anti-bot. Mitigação:
  retentativa com cookies e mensagem clara. Validar também na VPS.
- O layout dos cards muda sem aviso (o workflow n8n já está desatualizado). Mitigação: erro
  `ML_LISTING_LAYOUT` explícito em vez de lista vazia, e fixtures para atualizar o parser.
- O `createLink` é um endpoint interno não documentado; o formato da resposta em lote (`urls[].origin_url`/
  `short_url`) vem do workflow e é confirmado na validação real.
- O preço do card é o preço exibido na listagem; descontos de Pix/cupom aplicados só no checkout não entram.
