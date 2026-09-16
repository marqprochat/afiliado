# Design: Geração real de link via SiteStripe (Fase 2 — Amazon)

**Data:** 2026-09-16
**Status:** Aprovado

## Contexto

A Fase 1 (docs/superpowers/specs/2026-09-16-marketplaces-ui-unificada-design.md) generalizou o armazenamento de cookie de sessão para Amazon (`amazonSession`), mas manteve a geração de link 100% baseada em tag — o cookie só era guardado, sem uso. Esta fase implementa a geração real de link curto via SiteStripe, o painel de afiliados injetado pela Amazon em páginas de produto quando o usuário está logado como associado, replicando o padrão já usado para o Mercado Livre em `packages/marketplaces/src/mercadolivre/official-link.ts`.

## Investigação (feita em sessão, com o navegador do usuário logado em uma conta real de Associados Amazon BR)

Inspecionando a rede ao clicar em "Obter link" → "Copiar link de associado" no SiteStripe de uma página de produto (`amazon.com.br/dp/<ASIN>`), foi capturada a chamada real:

```
GET https://www.amazon.com.br/associates/sitestripe/getShortUrl
    ?longUrl=<url-encoded, contendo linkCode=sl2&tag=<storeId>&linkId=<id>&ref_=as_li_ss_tl>
    &marketplaceId=526970
    &storeId=<storeId>
```

- Autenticado via cookies de sessão do domínio `amazon.com.br` (mesmas cookies que o usuário já loga no site).
- `marketplaceId=526970` é o Brasil (constante, não varia por usuário).
- `storeId` é a tag de afiliado do usuário (equivalente ao `affiliateTag`/`tag` já salvo).
- O resultado observado foi um link curto no domínio `link.amazon` (ex.: `https://link.amazon/B07AMQVrO`) — **não** o clássico `amzn.to`. Isso sugere que a Amazon pode variar o domínio de encurtamento por conta/região, então a extração da URL da resposta deve ser tolerante a qualquer domínio, não fixada em `amzn.to` nem em `link.amazon`.
- Não foi possível capturar o corpo exato da resposta JSON nesta sessão (limitação da ferramenta de inspeção usada, que bloqueia leitura de respostas de chamadas que carregam cookies/query strings sensíveis). A extração da URL final terá que ser feita por busca de padrão (regex `https?://\S+`) no corpo da resposta, e não por um campo JSON específico assumido a priori.

## Decisões de design

### 1. Novo módulo `packages/marketplaces/src/amazon/official-link.ts`

Espelha a estrutura de `mercadolivre/official-link.ts`:

```ts
export class AmazonSessionError extends Error {
  constructor(message: string, public code: 'AMAZON_SESSION_EXPIRED' | 'AMAZON_SITESTRIPE_ERROR') {
    super(message);
  }
}

export async function generateOfficialAmazonLink(
  productUrl: string,
  cookies: Record<string, string>,
  storeId: string,
): Promise<string>
```

- Monta a URL do endpoint com `longUrl` (a URL do produto, com `tag=<storeId>` já embutida, igual ao link por tag que já existe hoje), `marketplaceId=526970` (constante), `storeId`.
- Faz `fetch` com header `Cookie` montado a partir do mapa `cookies`, e um `User-Agent` de navegador comum (evita bloqueio trivial por bot).
- Detecta sessão expirada/erro: resposta não-200, ou corpo indicando redirect para login (heurística de string, ex. contém `signin` ou `ap/signin` na URL final após redirects) → lança `AmazonSessionError('AMAZON_SESSION_EXPIRED', ...)`.
- Em caso de 200 sem indício de login: extrai a primeira URL `https?://\S+` encontrada no corpo da resposta. Se nenhuma URL for encontrada, lança `AmazonSessionError('AMAZON_SITESTRIPE_ERROR', ...)`.
- Cache em memória de 1h por `productUrl` (mesmo padrão do `officialLinkCache` do ML), para não repetir a chamada a cada envio de oferta.

### 2. Integração em `packages/marketplaces/src/tag-adapter.ts`

`toAffiliateLink()` passa a tentar `generateOfficialAmazonLink` quando `kind === 'AMAZON'` e `creds.amazonSession?.cookies` existir, com fallback para o link por tag atual (`buildAffiliateUrl`) se a chamada lançar `AmazonSessionError` — mesma lógica condicional já usada para Mercado Livre, sem alterar o comportamento quando não há sessão salva (só tag).

### 3. `checkConnection` da Amazon passa a validar de verdade quando há sessão

Hoje `checkConnection` para Amazon é local-only (`hasTagCredentials`). Quando `amazonSession.cookies` existir, `checkConnection` chama `generateOfficialAmazonLink` com uma URL de teste (ex. a home da Amazon ou um produto fixo) — se funcionar, `status: OK`; se lançar `AmazonSessionError`, `status: ERROR` com a mensagem. Quando não há sessão (só tag), mantém o comportamento local-only atual — sem mudança de comportamento para quem não configurou cookie.

## Fora de escopo

- Magalu (Fase 3, ainda não investigada).
- Mudanças na extensão Chrome para capturar cookies da Amazon automaticamente (a Fase 1 já habilita colagem manual do cookie na UI; isso é suficiente para esta fase).
- Qualquer alteração no fluxo do Mercado Livre.

## Risco assumido

Este endpoint é interno/não documentado da Amazon. A implementação é tolerante a falhas (cai para link por tag automaticamente), mas não há garantia de que o endpoint continue estável — se a Amazon mudar o formato, o sistema não quebra, apenas deixa de gerar o link curto oficial e volta ao link por tag, que sempre funcionou.

## Testes

- Teste unitário de `generateOfficialAmazonLink` com um servidor de teste local mockado (não a Amazon real): sucesso extraindo URL da resposta, cache funcionando, erro de sessão expirada lançando `AmazonSessionError`.
- Teste de `toAffiliateLink` para AMAZON com e sem `amazonSession`, confirmando o fallback.
- Teste de `checkConnection` para AMAZON com sessão (mock de sucesso e de falha) e sem sessão (comportamento local-only preservado).
