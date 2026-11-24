# Link do site nas ofertas postadas — design

Data: 2026-11-23 · Status: aprovado no brainstorming, aguardando revisão da spec

## Objetivo

Toda oferta de produto postada nos grupos do **dono da aplicação** passa a levar o link da página do
produto no site público (`https://superofertasedescontos.com.br/ofertas/<slug>`), e não mais o link da
loja. A página mostra o comparativo de preços, o cupom (quando houver) e o botão "Pegar Oferta", que
leva ao **link de afiliado convertido**, de modo que a comissão é preservada.

## Decisões (tomadas com o usuário)

| Tema | Decisão |
|---|---|
| Caminhos cobertos | Buscas/lotes/fila/automações do app, extensão do navegador, bot do Telegram e espelhamento de grupos |
| Link de afiliado no site | Convertido na hora do envio (pelo worker, como já é hoje) e **gravado** em `ProductListing.affiliateUrl`. Shopee/AliExpress ficam com o subId do último envio |
| Cupom na página | O cupom capturado com o produto (`Product.couponCode`); se não houver, até 3 cupons `VALID` e não expirados da mesma loja |
| Falha ao montar a página | A mensagem sai com o link de afiliado direto (comportamento atual) e o fallback é registrado em log |
| Quem é afetado | Só o tenant do dono, por uma configuração liga/desliga `siteLinks.enabled`. Afiliados continuam com link direto |
| Cupom enviado sozinho (sem produto) | Sem mudança |

Fora do escopo: /ofertas multi-tenant para afiliados; rastreamento de cliques por oferta; redirecionamento
`/ofertas/<slug>/ir`.

## Arquitetura

### 1. Pacote `@afilados/deals`

`apps/api/src/lib/price-engine.ts` sai da API e vira `packages/deals/src/price-engine.ts`, exportado por
`@afilados/deals` e usado pela API e pelo worker. Mudanças no motor:

- `indexProductInPriceEngine` aceita `affiliateUrl?: string` e grava esse valor em
  `ProductListing.affiliateUrl`. Sem ele, **preserva** o valor existente (hoje sobrescreve com
  `originalUrl`). Em listagem nova sem link convertido, usa `originalUrl`.
- Retorna também o `slug` do `MasterProduct` (hoje retorna só `masterProductId`).
- `getDealDetailBySlug` passa a devolver `coupons: { code, description, discountLabel, expiresAt }[]`
  (regra da seção 4).

### 2. Módulo `publishOffer` (worker)

`apps/worker/src/lib/publish-offer.ts`:

```ts
publishOffer(db, tenantId, product: ProductData, affiliateUrl: string): Promise<string | null>
```

1. Lê a configuração `Setting{key:'siteLinks'}` → `{ enabled: boolean }`. Desligada ou ausente →
   `null`.
2. Sem `PUBLIC_SITE_URL` no ambiente → `null` + log de aviso (uma vez por processo).
3. `await indexProductInPriceEngine(db, tenantId, product, { affiliateUrl })`.
4. Retorna `${PUBLIC_SITE_URL}/ofertas/${slug}`.
5. Qualquer exceção ou tempo acima de 5 s → log `publish-offer fallback` com tenant/source/url e
   retorna `null`.

O chamador usa `siteUrl ?? affiliateLink`. Nenhum envio é bloqueado por falha de publicação.

Nova variável `PUBLIC_SITE_URL` em `apps/worker/src/config.ts` (opcional) e no serviço worker do
`docker-compose.prod.yml`: `PUBLIC_SITE_URL: https://${DOMAIN}`.

### 3. Pontos de envio

**Mensagens por template**: `apps/worker/src/processors/send-offer.ts` (ramo do produto, logo após o
`affiliateLink` ser calculado) e `apps/worker/src/processors/send-telegram.ts` (mesmo trecho):

- `link = (await publishOffer(...)) ?? affiliateLink`
- `renderTemplate(..., { affiliateLink: link })` e prévia do WhatsApp com `url: link`.
- Cobre buscas/importação, fila, lotes, automações, captura da extensão e link enviado ao bot do
  Telegram.

**Mensagens de texto livre**: `customText` do `send-offer.ts` (extensão "copiado do grupo", texto
colado no Telegram, envio manual) e modo CLONE do espelhamento (`mirror-message.ts`):

- Novo `rewriteOfferLinks(text, ctx)` em `apps/worker/src/lib/rewrite-offer-links.ts`. Para cada URL
  de loja suportada no texto (já convertida para afiliado nesses fluxos), resolve o link original, busca
  os dados do produto com os fetchers de `@afilados/marketplaces`, chama `publishOffer` e troca a URL
  pelo link do site. Se a busca falhar ou a loja não tiver fetcher, mantém a URL de afiliado.
- No máximo 5 URLs por mensagem.
- A prévia usa a primeira URL do texto já reescrito.
- Espelhamento em modo TEMPLATE (Shopee): usa `publishOffer` com os dados que já busca.

Cupom enviado sozinho (`couponId`) não muda.

### 4. Página da oferta e cupons

- Regra do cupom em `getDealDetailBySlug`:
  1. O `Product` mais recente com o mesmo `(source, externalId)` da melhor listagem e `couponCode`
     preenchido → esse cupom.
  2. Senão, até 3 `Coupon` com `store` = loja da melhor listagem, `status = VALID` e `expiresAt` nulo
     ou futuro, ordenados por `discountValue` decrescente.
- `apps/web/src/app/ofertas/[slug]/page.tsx`: bloco "Cupom disponível" abaixo do preço, com código,
  descrição e botão "Copiar". Sem cupom, o bloco não aparece.
- `resolveTenantId` em `apps/api/src/routes/deals.ts` (requisição anônima) passa a preferir o tenant do
  superadmin antes do "primeiro tenant com MasterProduct", para que as páginas publicadas pelo dono
  sejam sempre as servidas.

### 5. Configuração

- Chave `siteLinks` em `Setting` (`{ enabled: boolean }`), editável na tela de Configurações por quem não
  é afiliado (`forbidAffiliate`). Ausente = desligado. Uma migração de dados liga a chave para o tenant
  do superadmin.

## Erros

- Publicação nunca impede o envio: qualquer falha cai no link de afiliado.
- A indexação passa a ser aguardada, o que adiciona latência ao envio; teto de 5 s por produto, depois
  fallback.

## Testes

- `packages/deals`: `indexProductInPriceEngine` grava o `affiliateUrl` convertido, não o sobrescreve
  sem novo valor e retorna o `slug`.
- `publishOffer`: chave desligada → `null`; sucesso → URL do site; exceção ou timeout → `null`.
- `rewriteOfferLinks`: troca o link com sucesso, mantém o link quando o fetcher falha, ignora URLs que
  não são de loja.
- `send-offer`: com a chave ligada, texto e prévia levam o link do site; desligada, comportamento atual.
- API `GET /deals/:slug`: devolve o cupom do produto; sem ele, cupons válidos da loja; ignora expirados.
- Web: a página mostra o bloco de cupom e copia o código.
- Validação final: Docker no servidor de testes e um envio real para um grupo de teste.
