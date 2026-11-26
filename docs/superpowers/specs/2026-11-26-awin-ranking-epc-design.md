# Ranking de lojas Awin por EPC

Data: 2026-11-26 · Subprojeto B da leva "novidades da API da Awin" (D → A → **B** → C).

## Objetivo
Priorizar as lojas Awin que mais convertem e pagam melhor, usando os indicadores oficiais de cada
programa, em vez de escolher só pelo desconto.

## Fonte de dados (Awin, API legada, `Authorization: Bearer <token>`)
- `GET https://api.awin.com/publishers/{publisherId}/programmes?relationship=joined` — lista os
  programas aprovados (já usado em `listAwinProgrammes`).
- `GET https://api.awin.com/publishers/{publisherId}/programmedetails?advertiserId={id}&relationship=joined`
  — devolve `programmeInfo` (id, name, displayUrl, logoUrl, currencyCode, …), `kpi`
  (`approvalPercentage`, `averagePaymentTime`, `awinIndex`, `conversionRate`, `epc`,
  `validationDays`) e `commissionRange` (lista de `{min, max, type}`).
- Limite da API legada: 20 chamadas/min por usuário → intervalo mínimo de 3,1 s entre chamadas.
  Mapper tolerante (números podem vir como string; campos ausentes → null).

## Desenho
1. **Modelo `AwinProgrammeStats`** (tenantId, advertiserId, name, logoUrl?, displayUrl?, currency?,
   epc Decimal?, conversionRate Decimal?, approvalPercentage Decimal?, averagePaymentTime Int?
   (dias), validationDays Int?, awinIndex Decimal?, commissionMin Decimal?, commissionMax Decimal?,
   commissionType String?, score Decimal?, fetchedAt). `@@unique([tenantId, advertiserId])`,
   índice `(tenantId, score)`.
2. **Score** (puro, `packages/marketplaces/src/awin/programme-score.ts`):
   `score = epc × (approvalPercentage/100)`; sem `approvalPercentage` usa `epc × 0,8`; sem `epc` →
   `null` (vai para o fim). Desempate: `conversionRate` maior, depois `averagePaymentTime` menor.
3. **Sincronização no worker** (`awin-programme-stats`): agendador no padrão de
   `coupon-sync-scheduler`, 1×/dia por tenant dono das credenciais Awin (publisherId + token; não
   roda para afiliados, que compartilham o publisher). Lista programas joined e busca detalhes um a
   um respeitando 3,1 s; upsert. 401/403 reaproveita `AWIN_TOKEN_ERROR` do subprojeto D. Programas
   que saíram da lista joined são removidos da tabela.
   Rota autenticada `POST /api/v1/marketplaces/awin/programme-stats/refresh` enfileira a sincronização
   (dedupe por jobId) e `GET /api/v1/marketplaces/awin/programme-stats` lista ordenado por score.
4. **Onde o ranking aparece/atua**
   - Drawer da Awin (`AwinProgramsPanel`): tabela "Indicadores dos programas" ordenada por score com
     EPC, conversão, aprovação, prazo médio de pagamento, comissão (faixa) e data da atualização;
     botão "Atualizar indicadores".
   - Buscar Produtos → Awin: o seletor de loja lista as lojas ordenadas por score, exibindo o EPC
     (ex.: "Drogal BR · EPC R$ 0,42"); nova opção de ordenação "Melhores lojas (EPC)" nos resultados
     (ordena por score da loja e, dentro da loja, pela ordem atual).
   - Automações: se o motor de automação já seleciona produtos do catálogo Awin, regras com fonte
     AWIN ganham a opção "Priorizar lojas com melhor EPC" (ordena candidatos pelo score da loja) e
     "EPC mínimo" (opcional). Se o motor não usa o catálogo Awin, isso fica fora (registrar no plano).
5. **Fora do escopo:** atualizar EPC em tempo real; ranking para outras redes.

## Testes
- Mapper de `programmedetails` com fixture; cliente (URL, auth, 401).
- Score e desempates.
- Sync: respeita intervalo (timer injetável), upsert, remoção de programas não joined, 401.
- Rotas de listagem/refresh.
- Web: tabela do drawer ordenada; seletor de loja com EPC; ordenação "Melhores lojas (EPC)".
