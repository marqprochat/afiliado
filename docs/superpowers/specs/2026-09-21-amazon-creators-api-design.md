# Design: Dados de produto via Creators API (Fase 3 — Amazon)

**Data:** 2026-09-21
**Status:** Aprovado

## Contexto

A integração da Amazon hoje usa scraping de HTML (`packages/marketplaces/src/scrapers/amazon.ts`, Cheerio) para extrair dados de produto (título, preço, imagem, etc.) a partir da URL. É frágil: sujeito a bloqueio/CAPTCHA e a mudanças de layout da Amazon, sem contrato estável.

A Amazon oferece a **Creators API** (sucessora oficial da Product Advertising API 5.0, documentada em https://associados.amazon.com.br/creatorsapi/docs/en-us/introduction), um serviço REST autenticado que devolve dados de produto de forma estruturada e estável, usando as credenciais de Associado. O dono do projeto já tem (ou vai conseguir) as credenciais e cumpre o requisito de elegibilidade (mínimo de 10 vendas qualificadas nos últimos 30 dias).

Esta fase substitui o scraping da Amazon pela chamada oficial `GetItems`. Ficam fora desta rodada: `SearchItems`/busca por categoria e `GetBrowseNodes` (descartados por incerteza sobre o formato real de resposta sem poder testar contra a API de verdade antes de implementar — mesmo risco identificado na busca por categoria da Shopee, que hoje não retorna resultados).

O link de afiliado (`toAffiliateLink`, SiteStripe/tag) **não muda** — fica fora de escopo.

## Investigação (documentação pública da Creators API)

Resumo do que a documentação (thin/lossy em alguns pontos, ver "Riscos") expõe:

- **Autenticação**: OAuth2 client-credentials.
  - `POST https://api.amazon.com/auth/o2/token` com `{ grant_type: "client_credentials", client_id, client_secret, scope: "creatorsapi::default" }`.
  - Resposta: `{ access_token, token_type: "bearer", expires_in: 3600, scope }`.
  - Token usado como `Authorization: Bearer <access_token>` nas chamadas seguintes.
- **GetItems** — `POST` no host da Creators API (host exato não confirmado com certeza pela doc pública; ver "Riscos").
  - Parâmetros obrigatórios: `itemIds` (até 10 ASINs por chamada), `partnerTag`.
  - Opcionais relevantes: `itemIdType` (default `ASIN`), `marketplace` (`www.amazon.com.br` para BR), `resources`.
  - `resources` usados: `itemInfo.title`, `images.primary.large`, `offersV2.listings.price`, `parentASIN`.
  - Resposta: `itemResults.items[]`, cada item com `asin`, `detailPageURL`, `images`, `itemInfo`, `parentASIN`, e (esperado, não confirmado em detalhe) `offersV2.listings[].price`.
- **Cota inicial**: 1 TPS / 8.640 TPD nos primeiros 30 dias; cresce com receita de vendas enviadas (1 TPD por US$0,05 de receita; 1 TPS extra por US$4.320, até 10 TPS). Erro de estouro: `429 TooManyRequests`.
- **Locale BR**: `marketplace = "www.amazon.com.br"`, moeda `BRL`, idioma `pt_BR`.

## Decisões de design

### 1. Novo módulo `packages/marketplaces/src/amazon/creators-api.ts`

```ts
export class AmazonApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AMAZON_API_UNAUTHORIZED'
      | 'AMAZON_API_RATE_LIMITED'
      | 'AMAZON_API_ITEM_NOT_FOUND'
      | 'AMAZON_API_ERROR',
  ) { super(message); this.name = 'AmazonApiError'; }
}

export interface AmazonApiCredentials {
  clientId: string;
  clientSecret: string;
  partnerTag: string;
}

export async function getAccessToken(
  creds: Pick<AmazonApiCredentials, 'clientId' | 'clientSecret'>,
  opts?: { fetchImpl?: typeof fetch },
): Promise<string>;

export async function getItems(
  asins: string[], // até 10; chamador é responsável por dividir em lotes
  creds: AmazonApiCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<AmazonGetItemsResponse>;

export function mapCreatorsApiItem(item: AmazonApiItem, originalUrl: string): ProductData;
```

- **Token**: cacheado em memória por `clientId` (chave composta), renovado quando faltar menos de 60s para expirar. Uma falha de auth (401/403) na chamada de token ou no GetItems lança `AmazonApiError('AMAZON_API_UNAUTHORIZED', ...)` — sem retry automático.
- **Rate limit**: fila simples em memória que espaça as chamadas a `getItems` em no mínimo 1s entre si (quota inicial de 1 TPS). Não implementa lógica adaptativa de aumento de cota — é um limite conservador fixo, revisável depois se o volume justificar. `429` do lado da Amazon vira `AmazonApiError('AMAZON_API_RATE_LIMITED', ...)`, propagado sem retry.
- **Batching**: `getItems` aceita até 10 ASINs; loop interno faz múltiplas chamadas se receber mais, respeitando o espaçamento de 1s entre elas.
- **Mapeamento** (`mapCreatorsApiItem`): usa o mesmo formato de saída que o scraper já produz (`ProductData`: `title`, `price`, `originalPrice?`, `discountPct?`, `images`, `shipping`, `externalId` = ASIN, `originalUrl`, `raw`). Todo campo de preço/desconto é lido de forma defensiva (`?.`, fallback `undefined`) — se a Amazon devolver uma estrutura diferente da esperada para `offersV2.listings[0].price`, o produto ainda é criado com o que existir (título/imagem/ASIN no mínimo), não lança erro. `raw` guarda o item bruto retornado pela API, para facilitar depuração/ajuste do mapeamento assim que houver o primeiro teste real.
- ASIN não encontrado na resposta (ex.: array `items` sem esse ASIN, ou presente em `errors`) → `AmazonApiError('AMAZON_API_ITEM_NOT_FOUND', ...)` para aquele ASIN específico; não interrompe o processamento dos outros ASINs do lote (mesmo padrão de "continua os outros" que `fetchByUrls` já tem hoje para erros de scraping).

### 2. Extração de ASIN e integração em `tag-adapter.ts`

- Reaproveita a mesma regex de ASIN já usada em `scrapers/amazon.ts` (`/\/dp\/([A-Z0-9]{10})/i`, `/\/gp\/product\/([A-Z0-9]{10})/i`, `/\/product\/([A-Z0-9]{10})/i`), extraída para uma função exportada (`extractAsin(url): string | undefined`) reutilizável por ambos os módulos.
- `fetchByUrls` para `kind === 'AMAZON'`: para cada URL, extrai o ASIN; se não conseguir, pula a URL (mesmo padrão "continua os outros" já existente). Agrupa os ASINs válidos em lotes de 10, chama `getItems`, mapeia cada resultado de volta para a URL original correspondente. **Sem fallback para scraping** — se `getItems` falhar (qualquer `AmazonApiError`), o(s) produto(s) daquele lote simplesmente não entram no resultado (mesmo comportamento de "continua os outros" que já existe hoje no catch genérico).
- `scrapeAmazon`/`parseAmazonHtml` (`scrapers/amazon.ts`) deixam de ser chamados pelo adapter. O arquivo e seus testes são removidos nesta fase (ficariam mortos; scraping de HTML não é mais necessário para Amazon).

### 3. Credenciais

- `TagCredentials` (`packages/shared/src/marketplaces.ts`) ganha:
  ```ts
  amazonApi?: { clientId: string; clientSecret: string };
  ```
  (a tag existente, `tag`, já serve como `partnerTag` — nenhuma duplicação de campo.)
- `marketplaceUpdateSchema` (`packages/shared/src/api.ts`) ganha `amazonClientId` e `amazonClientSecret` (opcionais, `z.string().min(1)`), só aplicados quando `kind === 'AMAZON'`.
- `PUT /marketplaces/:kind` (`apps/api/src/routes/marketplaces.ts`) grava `amazonApi: { clientId, clientSecret }` quando ambos os campos vierem preenchidos no body (mantém o valor anterior se não vier atualização, mesmo padrão dos outros campos).
- `publicConnection` (`apps/api/src/lib/marketplaces.ts`) expõe só `hasAmazonApiSecret: boolean` (nunca o secret em si) e `amazonClientId` (não é sensível, é um identificador público de app, análogo ao `appId` da Shopee).
- Tela de config (`apps/web/src/components/marketplaces/marketplace-config.ts`): `MARKETPLACE_CONFIGS.AMAZON.fields` ganha dois campos novos, `amazonClientId` (texto) e `amazonClientSecret` (senha), com `helpContent` explicando onde conseguir (Associates Central → Creators API → Register). `MarketplaceFieldKey` é estendido com esses dois valores.

### 4. `checkConnection` da Amazon

- Quando `amazonApi.clientId` e `amazonApi.clientSecret` estiverem configurados: chama `getAccessToken` seguido de um `getItems` de teste com um ASIN fixo conhecido (ex.: um ASIN estável de um produto Amazon genérico, a definir na implementação) e `resources: ['itemInfo.title']` (chamada mínima). Sucesso → `{ ok: true }`; `AmazonApiError` → `{ ok: false, error: <mensagem> }`.
- Quando não há `amazonApi` configurado: mantém o comportamento local-only atual (`hasTagCredentials`, exige `tag`).

## Fora de escopo

- `SearchItems` (busca por palavra-chave ou categoria/`SearchIndex`) e `GetBrowseNodes` — descartados nesta rodada pela incerteza de formato de resposta sem teste real prévio, e pelo precedente da busca por categoria da Shopee não retornar resultados hoje.
- Qualquer mudança em `toAffiliateLink`/SiteStripe (link de afiliado continua como está).
- Retry automático em `429`/erro transitório — falha é propagada explicitamente.
- Aumento dinâmico de cota / lógica adaptativa de TPS — limite fixo conservador de 1 req/s.

## Riscos assumidos

- A documentação pública da Creators API é rasa em alguns pontos centrais: o host exato do endpoint `GetItems` para o marketplace BR e a estrutura exata de `offersV2.listings[].price` (nomes de subcampos de preço/moeda/desconto) não foram confirmados com certeza — só o formato de alto nível (`resources` pedidos, containers de resposta). A implementação é defensiva no mapeamento (campos opcionais, sem crash em formato inesperado) e loga o item bruto, para que o primeiro teste real com credenciais válidas permita ajustar rapidamente qualquer nome de campo divergente.
- Sem fallback para scraping: se a API estiver fora do ar, com cota esgotada, ou credenciais erradas, produtos Amazon simplesmente não são importados até o problema ser corrigido (decisão explícita do dono do projeto).

## Testes

- Unit tests de `creators-api.ts` mockando `fetch`: token (sucesso, 401), `getItems` (sucesso mapeando 1 e vários ASINs, 401, 429, ASIN ausente na resposta, lote com mais de 10 ASINs dividido em duas chamadas com espaçamento).
- Unit tests de `mapCreatorsApiItem` com respostas variadas (com/sem desconto, sem imagem, sem preço) confirmando que não lança erro e preenche o que existir.
- Atualiza os testes de `tag-adapter.test.ts` que hoje esperam scraping para Amazon, substituindo por mocks de `creators-api`.
- Remove os testes de `scrapers/amazon.test.ts` (arquivo de origem removido).
- Teste de `checkConnection` para AMAZON com `amazonApi` configurado (mock de sucesso e falha) e sem `amazonApi` (comportamento local-only preservado).
