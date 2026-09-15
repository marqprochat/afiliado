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
