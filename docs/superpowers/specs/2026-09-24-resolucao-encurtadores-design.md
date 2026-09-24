# Resolução de links encurtados no espelhamento — design

**Data:** 2026-09-24
**Status:** aprovado

## 1. Problema

O espelhamento descarta mensagens cujo link de produto vem encurtado. Exemplo real recebido de um grupo de origem:

```
*Kit Starlink MINI Internet Via Satélite*
...
Link para compra:
https://meli.la/1h21Ywb
```

`extractStoreLinks` chama `parseProductUrl` e pula tudo que volta `UNSUPPORTED` (`packages/core/src/links.ts:19`). `parseProductUrl` só reconhece os domínios completos das lojas (`mercadolivre.com.br`, `amazon.com.br`, `shopee.com.br`, `magazineluiza.com.br`/`magazinevoce.com.br`, `aliexpress.com`, `awin1.com`), então `meli.la` cai em `UNSUPPORTED`. Com zero links, o processor grava `MirrorLog DISCARDED / no-links` e encerra.

Ignorar encurtador foi decisão deliberada da spec original da F2 (`docs/superpowers/specs/2026-09-15-f2-espelhamento-design.md:61` — "só URLs http(s) cujo `parseProductUrl` retorna loja conhecida; ignora encurtadores e terceiros"). Na prática a decisão está errada: grupos de afiliado no Brasil usam encurtador na maioria das ofertas, então o espelhamento fica inútil para o caso de uso real.

## 2. Escopo

**Dentro:** resolver encurtadores **oficiais das lojas** (lista fechada) antes de extrair os links, para que a oferta seja espelhada com o link de afiliado correto.

**Fora:**
- Encurtadores genéricos (`bit.ly`, encurtador próprio de grupo). Rejeitado por abrir vetor de SSRF sem contrapartida clara — reavaliar se os logs mostrarem volume relevante.
- Cache das resoluções. YAGNI: o volume de mensagens é baixo e o dedup por `productKey` já existe. Acrescentar depois se virar gargalo.
- Mudar `parseProductUrl`, que tem muitos consumidores (scraper de descoberta, produtos da API).

## 3. Allowlist

| Loja | Domínios |
|---|---|
| Mercado Livre | `meli.la` |
| Amazon | `amzn.to`, `a.co` |
| Shopee | `s.shopee.com.br`, `shope.ee` |
| AliExpress | `s.click.aliexpress.com`, `a.aliexpress.com` |

Magalu e Awin ficam de fora: os links recebidos hoje (`magazinevoce.com.br`, `awin1.com`) já são domínio completo e `parseProductUrl` os reconhece.

## 4. Arquitetura

Módulo novo no worker, injetado como dependência — segue o padrão que `MirrorMessageDeps` já usa para `gateway`, `downloadMedia`, `now`, `sleep`, `rng` e `bucketFor`. `packages/core` permanece livre de I/O, como é hoje.

**`apps/worker/src/mirror/resolve-short-links.ts`**

```ts
export async function resolveShortLinks(
  text: string,
  deps?: { fetch?: typeof fetch; timeoutMs?: number; maxHops?: number },
): Promise<Map<string, string>>  // url curta original → url expandida
```

Extrai as URLs do texto, mantém só aquelas cujo host está na allowlist e segue os redirects de cada uma lendo apenas o header `Location`. Se não houver nenhuma URL de encurtador no texto, retorna mapa vazio **sem fazer requisição alguma**.

**Extração de URL compartilhada.** Hoje `URL_RE` e `TRAILING` são privados em `packages/core/src/links.ts:9-10`. O resolver **não** pode reimplementar essa extração: se divergirem, casos de borda quebram em silêncio — `https://meli.la/1h21Ywb.` no fim de uma frase teria o ponto final removido pelo core e mantido pelo resolver, produzindo um 404. O core passa a exportar um helper `extractUrls(text): string[]` (extração + remoção de pontuação final), consumido tanto por `extractStoreLinks` quanto pelo resolver. Continua sendo função pura, sem I/O.

Alternativas descartadas: colocar a resolução em `packages/core` (introduziria I/O num pacote hoje 100% puro) e tornar `extractStoreLinks` async (converteria a peça pura mais testada do core em função de rede, para servir um único chamador).

## 5. Fluxo no processor

`extractStoreLinks` tem um único chamador: `apps/worker/src/processors/mirror-message.ts:77`.

Com encurtador surgem duas URLs com papéis distintos, e confundi-las quebra o espelhamento:

- a **curta** é a que aparece no texto da mensagem → precisa ser a chave usada por `rewriteLinks`
- a **expandida** é a que o adapter precisa para gerar o link de afiliado, e a que o `fetchByUrls` do modo TEMPLATE consome

O processor passa a montar uma lista local:

```ts
type ResolvedLink = { textUrl: string; targetUrl: string; parsed: ParsedProductUrl };
```

Para link já completo, `textUrl === targetUrl`. Montagem:

1. `links = extractStoreLinks(text)` → vira `ResolvedLink` com ambas as URLs iguais (comportamento atual preservado).
2. `expansions = await resolveShortLinks(text, deps)`.
3. Para cada `[shortUrl, expandedUrl]`, roda `parseProductUrl(expandedUrl)`; se reconhecer a loja, acrescenta `{ textUrl: shortUrl, targetUrl: expandedUrl, parsed }`.

A conversão para link de afiliado itera essa lista usando `targetUrl`. Em seguida:

- **CLONE:** o mapa de substituição é chaveado por `textUrl`, para que `rewriteLinks` encontre a string que de fato está no texto.
- **TEMPLATE:** o casamento do produto retornado por `fetchByUrls` é feito por `targetUrl`.

`packages/core` não muda.

## 6. Tratamento de erro

| Situação | Resultado |
|---|---|
| Encurtador resolve para loja não reconhecida | Ignorado, como qualquer link de terceiro |
| Resolução falha e não sobrou nenhum link | `MirrorLog DISCARDED`, reason `short-link-unresolved` |
| Resolução falha mas outros links funcionaram | Espelha normalmente; o motivo é anexado ao log, seguindo o padrão existente de `unsupported-store:X`. O link curto não convertido permanece intacto no texto |

A reason própria (em vez de reusar `no-links`) existe para separar no diagnóstico "não tinha link" de "tinha link, mas não consegui abrir".

## 7. Segurança

Seguir redirect de URL vinda de mensagem de terceiro é vetor de SSRF. Mitigações:

- Só hosts da allowlist são requisitados. URL de host desconhecido nunca gera requisição.
- Cada salto é validado **antes** de ser seguido: esquema obrigatoriamente `https`, e host não pode ser IP literal, `localhost` ou nome de rede privada.
- Máximo de 3 saltos.
- Timeout de 5s por link.
- `redirect: 'manual'` — só o header `Location` é lido; o corpo da resposta nunca é baixado.

## 8. Testes

**Unitários de `resolveShortLinks`** (com `fetch` falso):
- resolve encurtador conhecido e devolve o mapa curta → expandida
- host fora da allowlist não gera requisição alguma
- para de seguir ao estourar o máximo de saltos
- timeout resulta em falha da resolução daquele link, sem derrubar os demais
- rejeita salto para `http`
- rejeita salto para IP literal / host privado
- usa a mesma extração do core: link encurtado seguido de pontuação final (`...1h21Ywb.`) é requisitado sem o ponto

**Unitário do core:** `extractUrls` remove pontuação final e `extractStoreLinks` mantém o comportamento atual após passar a consumi-lo.

**Integração em `mirror-message.test.ts`:**
- mensagem com `meli.la` → `MIRRORED`, e no texto enviado a **URL curta** foi substituída pelo link de afiliado
- mensagem só com encurtador irresolúvel → `DISCARDED` com reason `short-link-unresolved`
- mensagem com um link completo válido + um encurtador que falha → `MIRRORED`, com o motivo anexado ao log

## 9. Decisões registradas

- **Allowlist fechada em vez de seguir qualquer link:** segurança por construção; o custo é não pegar `bit.ly` e encurtadores próprios de grupo.
- **Resolver no worker, não no core:** preserva `packages/core` sem I/O. Promover para pacote compartilhado se a descoberta ou a API vierem a precisar.
- **Sem cache na v1:** otimização sem evidência de necessidade.
- **`textUrl` vs `targetUrl` explícitos:** a confusão entre os dois é o erro mais provável desta implementação, já que quebraria a substituição no texto de forma silenciosa.
- **`extractUrls` exportado do core:** evita duas implementações divergentes de "o que conta como URL no texto", cujo sintoma seria um 404 intermitente difícil de rastrear.
