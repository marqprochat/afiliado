# Plano: ranking de lojas Awin por EPC

Spec: `docs/superpowers/specs/2026-11-26-awin-ranking-epc-design.md` · Branch `feat/awin-ranking-epc`.

## Decisão sobre automações (item 4 da spec)
O motor de automação **já usa o catálogo Awin**: `apps/worker/src/automation/discovery.ts`
(`discoverAwin`) busca em `AwinCatalogProduct` quando a regra tem `AWIN` entre os marketplaces.
Portanto a integração entra: campos `awinPrioritizeEpc` (Boolean, padrão false) e `awinMinEpc`
(Decimal opcional) em `AutomationRule`. Com a opção ligada (ou EPC mínimo), a descoberta Awin
busca mais candidatos (100), descarta lojas abaixo do EPC mínimo (lojas sem EPC conhecido também
saem quando há mínimo), ordena pelo score da loja (ordem estável) e fica com 20.

## Tarefas (TDD: teste falhando primeiro)
1. **DB/shared** — modelo `AwinProgrammeStats` (+ relação em `Tenant`, `TENANT_MODELS`), campos
   novos em `AutomationRule`, migração `20261126100000_awin_programme_stats` gerada com
   `prisma migrate diff` a partir do schema anterior. Fila `awin-programme-stats` + job em
   `packages/shared/src/queues.ts`; `awinPrioritizeEpc`/`awinMinEpc` no schema de automação;
   tipo `AwinProgrammeStatsItem` para a API.
2. **marketplaces** — `programme-details.ts`: `mapAwinProgrammeDetails` (tolerante: números em
   string, ausentes → null, fixture) e `getAwinProgrammeDetails` (URL, Bearer, 401/403 →
   `AWIN_UNAUTHORIZED`). `programme-score.ts`: `computeProgrammeScore` e
   `compareProgrammeStats` (score desc, null no fim; desempate conversão maior, prazo menor).
3. **worker** — processador `awin-programme-stats` (só dono das credenciais; lista joined,
   detalhes um a um com `sleep` injetável ≥ 3,1 s; upsert; remove os que saíram; 401 →
   `AWIN_TOKEN_ERROR`); agendador 1×/dia (jobId por dia); registrar em `main.ts`.
4. **api** — `GET /marketplaces/awin/programme-stats` (lista ordenada; afiliado lê do dono) e
   `POST /marketplaces/awin/programme-stats/refresh` (jobId fixo por tenant para dedupe; só dono).
   `/products/awin-stores` passa a devolver as lojas ordenadas por score com EPC (`items`),
   mantendo `stores: string[]`.
5. **worker/automação** — `discoverAwin` aplica EPC mínimo e prioridade por score.
6. **web** — tabela "Indicadores dos programas" no drawer da Awin (ordenada por score, botão
   "Atualizar indicadores", rolagem horizontal da tabela no celular); seletor de loja com EPC ("Drogal BR · EPC R$ 0,42");
   ordenação "Melhores lojas (EPC)" nos resultados da Awin (score da loja, depois ordem atual);
   opções "Priorizar lojas com melhor EPC" e "EPC mínimo" no formulário de automação quando Awin
   está marcada.

## Verificação
Vitest local nos pacotes sem DB, `tsc --noEmit` por pacote, testes com DB no servidor
(`.superpowers/sdd/remote.sh`), rebuild do Docker (api, worker, web) e conferência da migração.
