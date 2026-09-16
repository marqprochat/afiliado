# Fase 3 — Ingestão de Produtos ML / Amazon / Magalu & Extensão Connect

**Data:** 2026-09-15
**Status:** Aprovado
**Depende de:** 2026-09-14-afilados-architecture-design.md (§4, §5, §10), Fase 1 e Fase 2 completas em main.

---

## 1. Resultado Esperado

O usuário afiliado agora consegue:
1. **Importar produtos de qualquer marketplace suportado** (Shopee, Mercado Livre, Amazon e Magalu) apenas colando a URL de produto ou lista de URLs na interface web (/produtos).
2. **Extrair metadados ricos em tempo de importação**:
   - Título, imagens em alta resolução, preço atual, preço original (de/por), percentual de desconto calculado.
   - Detecção de **Frete Grátis** e selo **Full** (Mercado Livre).
   - Detecção de **Oferta Relâmpago** com contagem regressiva / data de término.
   - Detecção e extração de **Cupom de Desconto** embutido na página do produto.
3. **Usar a Extensão Chrome  Afilados Connect (pps/extension)**:
   - Manifest V3 instalável no Google Chrome / Edge / Brave.
   - Conexão simplificada com a conta do Afilados via API Key do tenant.
   - Botão Capturar Oferta diretamente na página de qualquer produto (ML, Amazon, Magalu, Shopee) para enviar direto para a Fila de Triagem (QueueItem) do Afilados com 1 clique.
   - Extração e sincronização de cookies/sessão autenticada de afiliados (para gerar links oficiais meli.la do Mercado Livre e capturar comissões).
4. **Gerar Links Oficiais de Afiliado com Fallback Inteligente**:
   - Mercado Livre: suporte a gerador oficial via sessão/cookies com fallback para tags matt_word + matt_tool.
   - Amazon: link com tag de associado (	ag=...).
   - Magalu: conversão para vitrine Magazine Você (magazinevoce.com.br/<loja>/...).
   - Shopee: API oficial com SubID e link encurtado.
5. **Enriquecimento em Background (product-enrich BullMQ queue)**:
   - Importações por lista de URLs não travam a API: enfileiram jobs de scraping com cache e rate-limiting gentil por domínio.

---

## 6. Sessão do Mercado Livre (cookies) — como ficou implementado (2026-09-16)

- **Coleta:** o service worker da extensão (`apps/extension/background/background.js`) lê os cookies de `mercadolivre.com.br` e envia para `POST /api/v1/extension/session` na instalação, no startup do navegador, a cada 6h (alarme), com debounce de 5s quando um cookie do ML muda, e manualmente pelo botão "Sincronizar sessão" do popup.
- **Armazenamento:** os cookies ficam **criptografados** (AES-256-GCM, `encryptJson`) dentro de `MarketplaceConnection.encryptedCredentials` do tenant, no campo `mlSession { cookies, syncedAt }` de `TagCredentials`. A API pública (`GET /marketplaces`) expõe apenas `mlSessionSyncedAt`; o PUT das tags preserva a sessão.
- **Uso:** `createTagAdapter('MERCADOLIVRE').toAffiliateLink` tenta `generateOfficialMlLink` (`packages/marketplaces/src/mercadolivre/official-link.ts`) com cache em memória de 1h por URL; em qualquer falha (sessão expirada, endpoint mudou) cai para `matt_word`/`matt_tool`. Com sessão sincronizada, `checkConnection`/`loadTagCredentials` aceitam a conexão mesmo sem as tags.
- **Ponto a validar em produção:** o endpoint interno do painel (`ML_LINKBUILDER_ENDPOINT`, padrão `https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink`) não é documentado. Se o ML mudar o caminho/payload, basta ajustar a env var; a resposta é lida de forma tolerante (qualquer `https://meli.la/...` no JSON).

## 7. Importação em lote (fila `product-enrich`)

- `POST /products/import` com **uma** URL de ML/Amazon/Magalu raspa na hora; com **várias**, cria produtos-esqueleto (`title: "Importando…"`, `raw.pendingEnrich: true`) e enfileira jobs `enrich-<productId>` (3 tentativas, backoff exponencial). Shopee continua síncrono (API oficial).
- Worker: concorrência 2 e `limiter { max: 6, duration: 10s }`; metadados raspados ficam 2h em cache no Redis (`enrich:<kind>:<sha1(url)>`).
- Produto-esqueleto adicionado à fila de triagem entra como `PENDING_ENRICH` e vira `PENDING` quando enriquecido; a web atualiza o card via evento `product.enriched` e `GET /products?ids=`.
