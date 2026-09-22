# Awin como marketplace — design

**Data:** 2026-09-22
**Status:** aprovado para virar plano

## Contexto

O projeto já integra Shopee (API GraphQL com busca ao vivo), Amazon (Creators API, busca por ASIN via URL), Mercado Livre e Magalu (scraping por URL). O dono quer adicionar a Awin como mais um marketplace de origem de produtos para as automações de disparo.

A Awin não tem API de busca em tempo real por palavra-chave. O modelo é de **datafeeds**: cada anunciante (advertiser/programa) que o afiliado é aprovado publica um feed CSV com todo o catálogo, baixável via `https://productdata.awin.com/datafeed/list/apikey/<datafeedApiKey>` (lista os feeds disponíveis) e uma URL de download por feed (`Create-a-Feed`). Cada linha do feed já inclui um `aw_deep_link` — o link de afiliado pronto, com o tracking do publisher embutido — então não é necessário montar link de afiliado na mão para produtos vindos do catálogo importado.

Por não ter busca ao vivo, "buscar produtos" na Awin significa: importar o(s) feed(s) configurados para uma cópia local, e buscar dentro dessa cópia.

## Decisões

- **Escopo**: importar e indexar feeds localmente, com busca por palavra-chave rodando sobre a cópia local — não apenas geração de link de afiliado avulso.
- **Múltiplos feeds**: a configuração aceita uma lista de `feedIds` (um afiliado normalmente participa de vários programas).
- **Atualização do catálogo**: botão manual "Importar agora" na tela de configuração, mais reimport automático periódico (timer no worker, intervalo configurável, default 12h).
- **Produtos que saíram do feed**: cada rodada de import apaga do cache os produtos daquele `feedId` que não vieram na versão mais recente (ver "Poda de produtos obsoletos" abaixo) — evita sugerir produtos com promoção encerrada.
- **Produtos já enfileirados/enviados não são afetados**: a tabela `Product` (usada pelas automações/batches) já guarda uma cópia independente do produto no momento da descoberta, como acontece hoje para os demais marketplaces — apagar do cache da Awin não mexe em nada que já foi copiado para lá.

## Credenciais

Novo tipo `AwinCredentials` (não reaproveita `TagCredentials`, que é usado por Amazon/ML/Magalu — Awin precisa de uma lista de feeds, então tem forma própria, no mesmo espírito de `ShopeeCredentials`):

```ts
interface AwinCredentials {
  publisherId: string;   // awinaffid — usado no clickref e em eventuais fallbacks de link
  datafeedApiKey: string; // chave usada no endpoint productdata.awin.com
  feedIds: string[];     // um feedId por programa/anunciante que o publisher acompanha
}
```

Persistidas criptografadas na tabela `MarketplaceConnection` existente (mesmo mecanismo hoje usado por Shopee/Amazon/ML/Magalu), com `kind = 'AWIN'`.

## Modelo de dados novo

`AwinCatalogProduct` (schema.prisma) — cache local do catálogo importado; não é referenciado por FK de `Product`/`AutomationQueueItem` (é só a fonte de onde a busca lê antes de copiar para `Product`):

```prisma
model AwinCatalogProduct {
  id             String   @id @default(cuid())
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  feedId         String
  advertiserId   String?
  advertiserName String?
  externalId     String   // aw_product_id (chave do produto dentro do feed)
  title          String
  price          Decimal  @db.Decimal(12, 2)
  originalPrice  Decimal?  @db.Decimal(12, 2)
  imageUrl       String?
  deepLink       String   // aw_deep_link — já é o link de afiliado
  raw            Json
  lastImportedAt DateTime @default(now())

  @@unique([tenantId, feedId, externalId])
  @@index([tenantId, title])
}
```

O índice em `(tenantId, title)` sustenta a busca por palavra-chave (`ILIKE`/`contains`), consistente com o filtro de `blockedKeywords` que as regras de automação já fazem em memória sobre o título.

## Poda de produtos obsoletos

A cada rodada de import de um `feedId`:
1. Marca o horário de início (`runStartedAt`).
2. Faz upsert (por `tenantId + feedId + externalId`) de cada linha do CSV baixado, atualizando `lastImportedAt = now()`.
3. Ao terminar o CSV inteiro, apaga `AwinCatalogProduct` onde `tenantId + feedId` batem e `lastImportedAt < runStartedAt` — ou seja, qualquer produto que não apareceu nesta versão do feed.

Isso evita a janela onde a busca ficaria "zerada" durante o import (não apaga tudo antes de inserir) e escopa a poda por feed (reimportar um feed nunca apaga produtos de outro).

## Pipeline de import

Novo módulo `packages/marketplaces/src/awin/`:
- `datafeed.ts` — `listDatafeeds(datafeedApiKey)` (parseia o CSV de listagem) e `downloadFeed(feedUrl)` (baixa e parseia o CSV do catálogo, usando `csv-parse`, já é dependência do monorepo). Puro HTTP + parsing, sem acesso a banco — mesmo espírito de `amazon/creators-api.ts`.
- `mapper.ts` — `mapAwinRow(row, feedId): AwinCatalogProductInput` (linha do CSV → forma pronta para upsert) e `mapAwinCatalogRowToProductData(row): ProductData` (cache local → `ProductData`, para alimentar a automação/enriquecimento).

Novo processor no worker (`apps/worker/src/processors/awin-import.ts`), acionado por:
- Rota manual: `POST /marketplaces/awin/import` (botão "Importar agora" na tela de config).
- Timer periódico simples no `apps/worker/src/main.ts` (mesmo padrão do `AutomationScheduler`, mas mais simples: sem regras, só dispara o import de todos os tenants com Awin configurada a cada N horas).

Erros: falha ao baixar um `feedId` não interrompe os demais (best-effort, mesmo padrão do scraping ML/Magalu); o resultado do import registra por `feedId` se deu certo e quantos produtos foram importados/removidos, exibido na tela de config.

## Adapter (`createAwinAdapter`)

Implementa a interface `MarketplaceAdapter<AwinCredentials>` só nas partes que não dependem de banco:
- `checkConnection` — chama `listDatafeeds` e confere se os `feedIds` configurados aparecem na resposta; erro claro se algum `feedId` não for encontrado.
- `toAffiliateLink(creds, url, subId)` — para uma URL que já é um `aw_deep_link` (produto veio do catálogo importado), só acrescenta `&clickref=<subId>` na URL. Não tenta resolver URLs arbitrárias que não vieram do catálogo (não há API de lookup por URL na Awin) — lança `UnsupportedError` nesse caso, mesmo padrão já usado no tag-adapter.
- `search`/`fetchByUrls` — **não implementados no adapter** (ficam `undefined`/retornam vazio): como dependem do cache local (banco), essas operações são resolvidas na camada do worker/api, não dentro do pacote `marketplaces` (que fica livre de dependência de banco, mesmo critério já usado hoje).

Registrado em `packages/marketplaces/src/registry.ts` como uma terceira ramificação (hoje só distingue Shopee de "tag adapter"; Awin ganha a sua própria, com `opts.awin` injetável em teste, no mesmo padrão de `opts.shopee`).

## Pontos de integração na aplicação (todos os call sites que hoje distinguem Shopee/tag-adapter precisam de um terceiro ramo Awin)

1. `packages/shared/src/enums.ts` — adiciona `'AWIN'` em `MARKETPLACE_KINDS`.
2. `packages/db/prisma/schema.prisma` — `AWIN` no enum `MarketplaceKind`, tabela `AwinCatalogProduct`, migration.
3. `packages/marketplaces/src/registry.ts` — terceira ramificação do `getAdapter`.
4. `apps/worker/src/automation/discovery.ts` — `discoverAwin(rule, keyword)`: consulta `AwinCatalogProduct` por `tenantId` + título contendo a keyword, mapeia para `ProductData` via `mapAwinCatalogRowToProductData`, segue para `queueEligibleProducts` (mesmo filtro de `blockedKeywords`/preço/desconto já existente).
5. `apps/worker/src/processors/product-enrich.ts` — "adicionar produto por URL" da Awin busca no `AwinCatalogProduct` por `deepLink` igual à URL informada, em vez de tentar um fetch ao vivo.
6. `apps/worker/src/processors/send-offer.ts` — ramo próprio para `product.source === 'AWIN'` (como o de Shopee): decripta `AwinCredentials`, gera `subId` e chama `toAffiliateLink` com ele.
7. `apps/worker/src/processors/awin-import.ts` (novo) + fiação no `main.ts` (timer periódico + processor da fila/rota manual).
8. `apps/api/src/lib/marketplaces.ts` — `loadAwinCredentials`, validação de campos obrigatórios (mesmo padrão de `loadTagCredentials`).
9. `apps/api/src/routes/marketplaces.ts` — PUT aceita credenciais da Awin; nova rota `POST /marketplaces/awin/import`.
10. `apps/web/src/components/marketplaces/marketplace-config.ts` e `marketplace-drawer.tsx` — campos `publisherId`/`datafeedApiKey`/`feedIds` (lista) e botão "Importar agora" com status do último import.
11. `apps/web/src/lib/types.ts` — tipos espelhando a resposta pública da conexão Awin.

## Testes

Seguindo o padrão já usado (Amazon Creators API, Shopee):
- `packages/marketplaces/test/awin.test.ts` — parsing do CSV de listagem/feed, `mapAwinRow`, `checkConnection` (mock de fetch), `toAffiliateLink` (com e sem `aw_deep_link` reconhecido).
- `apps/worker/test/awin-import.test.ts` — upsert + poda de obsoletos (produto que sai do feed é removido; produto que continua é atualizado; falha em um feedId não afeta os demais).
- `apps/worker/test/automation-discovery.test.ts` — novo caso `discoverAwin` (busca local por keyword).
- `apps/api/test/marketplaces.test.ts` — PUT/GET de credenciais Awin, rota de import manual.

## Fora de escopo desta fase

- Busca ao vivo (não existe na Awin).
- Deep link building genérico via fórmula `cread.php` para URLs fora do catálogo importado (poderia ser adicionado depois se necessário).
- Uso do token OAuth da Partner API (relatórios, transações) — só a `datafeedApiKey` é necessária para este escopo.
