# Triagem → lote existente (com posição e reativação) — Plano

> Planejamento apenas (sem código). Execução: superpowers:subagent-driven-development ou executing-plans, TDD (teste primeiro) em cada task.

**Goal:** Na fila de triagem ("Produtos salvos"), enviar os produtos selecionados para um lote **já existente** (rodando, pausado ou concluído — este é reativado), escolhendo a posição: embaralhar / fim da fila / começo da fila.

## O que já existe (investigado)

| Peça | Onde | Aproveitamento |
| --- | --- | --- |
| Inserir **1** produto como próximo envio de lote ativo | `apps/api/src/lib/batches.ts` → `insertBatchItemNext` (usado por `POST /extension/capture`) | Base da generalização (N produtos + posição + DONE). Hoje **rejeita** `DONE`/`CANCELLED` (`BATCH_INACTIVE`) e só considera duplicado item PENDING/SENDING |
| Agendar horários respeitando a janela | `packages/core/src/schedule.ts` → `scheduleBatch(count, intervalMin, window, startAt)` | Reusar |
| Embaralhar intercalando por marketplace | `packages/core/src/shuffle.ts` → `shuffleInterleaved(items, keyOf, rng)` | Reusar para o "embaralhar" |
| Enfileirar / limpar jobs BullMQ | `lib/batches.ts` → `enqueueBatchItems`, `removeStaleJobs`, `removePendingJobs` | Reusar |
| Adicionar itens a lote **pausado** | `POST /batches/:id/items` (`batchAddItemsSchema`) em `routes/batches.ts` | Não serve: só PAUSED, sempre no fim, sem agendar |
| Reabrir lote concluído | `retryErrorItems` (`routes/batches.ts`) já faz `DONE → SCHEDULED` + enfileira | Mesmo padrão de reativação |
| Worker | `apps/worker/src/processors/send-offer.ts`: `sendOffer` **ignora** lote `DONE`/`PAUSED`/`CANCELLED` (`batch-inactive`); `finalizeBatchIfComplete` marca `DONE` quando não há PENDING/SENDING; ao enviar, `SCHEDULED → RUNNING` | **Sem mudança no worker**: basta o API reabrir o lote (`SCHEDULED`) antes dos jobs vencerem |
| Lista de lotes | `GET /batches` (últimos 50, todos os status; `total/sent/errors`) + `useBatches()` (poll 10 s) + `BatchSummary` em `apps/web/src/lib/types.ts` | Filtrar no cliente (excluir `CANCELLED`) |
| Triagem | `apps/web/src/components/queue/queue-table.tsx` (seleção por `QueueItem.selected` via `POST /queue/select`), `apps/web/src/app/(app)/enviar/page.tsx` (já calcula `selectedCount` = selecionados `PENDING`) | Ponto de entrada do botão |
| `GET /queue` | já oculta produtos que estão em lote não cancelado | Após enviar, os itens somem da triagem sozinhos |
| Reordenação | `PUT /batches/:id/order` (só pausado) e **WIP não commitado** no drawer: drag-and-drop + "Enviar a seguir" (`moveTo`) em `batch-manage-drawer.tsx` | Mesma semântica de `order` (não-pendentes < pendentes). **Não conflita**: a feature nova não mexe no drawer |
| Dialog | `components/ui/dialog.tsx` (base-ui) usado em `coupon-parse-modal.tsx`, `group-link-form-dialog.tsx` | Padrão do modal |

**Achados que mudam o desenho**
1. `BatchItem` tem `@@unique([batchId, productId])`: `insertBatchItemNext` só checa PENDING/SENDING, então re-inserir produto já `SENT`/`ERROR` no mesmo lote estoura constraint (500). A nova função deve **pular qualquer produto já presente no lote** (qualquer status) e devolver `skipped`.
2. Corrida: o worker pode marcar o lote `DONE` entre a leitura do API e a escrita. Depois de inserir os itens, reabrir de forma idempotente (`updateMany where status DONE → SCHEDULED`) e só então enfileirar.
3. `POST /batches` não valida `PENDING_ENRICH` quando recebe `productIds`; a nova rota deve exigir `QueueItem.status = PENDING` (produto ainda enriquecendo não pode ser enviado).
4. `PAUSED` entra na lista de destino (barato: `insertBatchItemNext` já só reordena e o "Retomar" agenda). `CANCELLED` fica de fora. "Excluído" = apagado do banco, então todo lote listado já é não-excluído.

## Decisões de produto (a confirmar; recomendação marcada)

- **Embaralhar** = os produtos novos entram em posições **aleatórias entre os pendentes**, preservando a ordem relativa dos pendentes existentes (entre os novos, `shuffleInterleaved` por marketplace). *Recomendado* (não desfaz a ordem que o usuário montou). Alternativa: embaralhar tudo (pendentes + novos).
- **Posição padrão** no modal: **fim da fila** (opção menos intrusiva).
- **Fluxo de UI**: botão → modal em 2 passos (1. escolher lote; 2. confirmar com posição e resumo). Alternativa: seletor de lote inline ao lado do botão + modal só de confirmação.
- **Lote concluído**: aviso explícito no passo 2 ("será reativado e voltará a rodar"); primeiro envio no próximo horário válido (`max(agora, último envio + intervalo)`, respeitando a janela de operação).
- Extensão Chrome (`GET /extension/batches`, só ativos) **fora de escopo**; como a função fica compartilhada, habilitar `DONE` na extensão depois é trivial.

## Contrato novo

`POST /api/v1/batches/:id/send-products` (autenticada, tenant)
- Body: `{ productIds: string[] (1..N), position: 'shuffle' | 'start' | 'end' }` (schema zod `batchSendProductsSchema` em `packages/shared/src/api.ts`).
- 200: `{ added: number, skipped: number, status: BatchStatus, estimatedEndAt: string | null, reactivated: boolean }`.
- Erros: 404 lote/produto inexistente; 409 `BATCH_INACTIVE` (lote `CANCELLED`); 409 se algum produto está `PENDING_ENRICH`; 500 `INTERNAL` se falhar o enfileiramento (lote volta a `PAUSED`, como hoje).
- Efeito: publica `batch.progress` (UI atualiza).

## Ordem e paralelismo

```
Backend (sequencial)           Frontend
  T1 core (planejador de posição) ─┐
  T2 shared (schema)  ────────────┼─► T6 (tipos/mutation/hook) ─► T7 modal ─► T8 botão+página
  T3 api lib (generalizar) ◄─T1,T2 │                                  (T7/T8 podem usar o contrato
  T4 api rota ◄─T3                 │                                   mockando apiFetch; não esperam T4)
  T5 testes de integração API ◄─T4 │
                                   └──────────────► T9 testes web ao lado de T7/T8
                                   T10 Docker (depois de TUDO)
```

**Paralelo:** T1 ∥ T2 (arquivos distintos). Depois: **Programador A** faz T3→T4→T5; **Programador B** faz T6→T7→T8→T9 (B só precisa do contrato acima + T2 opcional; testa com `apiFetch` mockado). T10 só após A e B.

## Tasks

### T1 — core: planejador de posição (puro, testável)
- **Arquivos:** `packages/core/src/batch-position.ts` (novo), export em `packages/core/src/index.ts`, `packages/core/test/batch-position.test.ts`.
- **Função:** `planBatchOrder<T>(pending: T[], incoming: T[], position: 'shuffle'|'start'|'end', keyOf: (t:T)=>string, rng?: ()=>number): T[]` → ordem final dos pendentes (existentes + novos). `start`: `[...incoming, ...pending]`; `end`: `[...pending, ...incoming]`; `shuffle`: novos embaralhados (`shuffleInterleaved`) e inseridos em posições aleatórias distintas, preservando a ordem relativa de `pending`.
- **Testes (rng injetado):** start/end preservam ordem de cada grupo; shuffle mantém todos os itens, mantém a ordem relativa dos pendentes, é determinístico com rng fixo; `pending` vazio (lote concluído) ⇒ resultado = novos embaralhados; `incoming` vazio ⇒ inalterado; não muta os arrays de entrada.

### T2 — shared: contrato
- **Arquivos:** `packages/shared/src/api.ts` (`batchSendProductsSchema`, tipo `BatchSendProductsBody`, `BATCH_POSITIONS`), `packages/shared/test/api.test.ts` (ou arquivo novo).
- **Testes:** aceita as 3 posições; rejeita posição inválida, `productIds` vazio; deduplica? (a rota deduplica; schema só valida).

### T3 — api lib: generalizar `insertBatchItemNext` (refactor guiado por testes)
- **Arquivo:** `apps/api/src/lib/batches.ts`.
- Nova `addProductsToBatch({ db, tenantId, batch, productIds, position, window, now?, rng? })` devolvendo `{ createdIds, added, skipped, status, estimatedEndAt, reactivated, runAt }`; `insertBatchItemNext` vira wrapper (`productIds=[id]`, `position='start'`) mantendo o contrato atual da extensão (inclusive `BATCH_DUPLICATE` e `BATCH_INACTIVE` para a extensão).
- Regras: rejeita `CANCELLED`; permite `DONE` (reativa) e `PAUSED` (só reordena, `runAt=null`); **pula** produto já presente no lote em qualquer status; ordem final via `planBatchOrder` (T1); `order` dos pendentes reatribuído a partir de `max(order dos não-pendentes)+1`; horários via `scheduleBatch` a partir de `max(agora, primeiro pendente)` ou, sem pendentes, `max(agora, último SENT/SENDING + intervalo)`; `removeStaleJobs` dos pendentes, transação (create dos novos + reorder/runAt dos pendentes + `batch.estimatedEndAt`), depois reabertura idempotente `DONE→SCHEDULED` (`updateMany where status='DONE'`) e `enqueueBatchItems`; falha ao enfileirar ⇒ lote `PAUSED` + `INTERNAL` (como hoje).
- **Testes primeiro** (ver T5) — pode começar escrevendo-os junto.

### T4 — api rota `POST /batches/:id/send-products`
- **Arquivo:** `apps/api/src/routes/batches.ts` (reusa `findBatch`, `getOperatingWindow`/`toCoreWindow`).
- Valida body (T2), carrega lote com itens ordenados, deduplica `productIds`, confere que todos os produtos existem no tenant (404) e que os `QueueItem` estão `PENDING` (409 se `PENDING_ENRICH`), chama T3, publica `batch.progress` (`app.events.publish`), responde o contrato.

### T5 — testes de integração da API (Postgres + Redis reais)
- **Arquivo:** `apps/api/test/batch-send-products.test.ts` (padrão de `extension-batch.test.ts`: janela desabilitada para horários determinísticos; limpar jobs no `afterEach`).
- **Casos:** (a) `end` em lote rodando: novos depois dos pendentes, pendentes intactos, jobs enfileirados com `delay` coerente; (b) `start`: novos primeiro e pendentes deslocados 1 intervalo cada; (c) `shuffle`: mesmos itens, ordem relativa dos pendentes preservada; (d) lote **DONE** → vira `SCHEDULED`, `reactivated=true`, itens PENDING com `runAt` ≥ último envio + intervalo, jobs criados; (e) lote **PAUSED**: só cria/reordena, `runAt` não agenda, sem jobs; (f) `CANCELLED` → 409; (g) produto já no lote (inclusive `SENT`) é pulado e contado em `skipped`, sem 500; (h) produto `PENDING_ENRICH` → 409; (i) produto/lote de outro tenant → 404; (j) corrida simulada: lote já `DONE` no banco no momento da escrita ainda termina `SCHEDULED`; (k) falha ao enfileirar (mock) → lote `PAUSED` + 500; (l) regressão: `extension-batch.test.ts` e `batches.test.ts` seguem verdes.

### T6 — web: tipos, mutation e seleção de lotes elegíveis
- **Arquivos:** `apps/web/src/lib/types.ts` (`BatchPosition`, resposta de `send-products`), helper puro `eligibleBatches(batches)` (ex.: `apps/web/src/lib/batch-target.ts`: exclui `CANCELLED`, ordena rodando/pausado antes de concluído, calcula `pending = total - sent - errors`), `apps/web/test/batch-target.test.ts`.

### T7 — web: `SendToBatchDialog` (modal em 2 passos)
- **Arquivos:** `apps/web/src/components/queue/send-to-batch-dialog.tsx`, `apps/web/test/send-to-batch-dialog.test.tsx`.
- **Props:** `open`, `onOpenChange`, `batches: BatchSummary[]`, `count: number`, `onConfirm({ batchId, position })`, `submitting?`.
- **Comportamento:** passo 1 lista os lotes elegíveis (nome, status via `StatusPill`, pendentes/total; vazio ⇒ mensagem "Nenhum lote disponível — crie um lote"); passo 2 mostra resumo ("Enviar N produto(s) para «Lote X»"), aviso se `DONE` ("será reativado e voltará a rodar"), radio de posição (embaralhar / fim da fila *(padrão)* / começo da fila) e botões Voltar / Confirmar (desabilitado enquanto `submitting`).
- **Testes:** lista só elegíveis (sem `CANCELLED`); não avança sem escolher; aviso de reativação só para `DONE`; padrão `end`; Confirmar chama `onConfirm` com lote e posição escolhidos; Voltar preserva a escolha.

### T8 — web: botão na triagem + integração na página
- **Arquivos:** `apps/web/src/components/queue/queue-table.tsx` (botão "Trazer selecionados para lote" ao lado de "N selecionado(s) pendente(s)"; desabilitado com 0 selecionados; nova prop `onSendToBatch`), `apps/web/src/app/(app)/enviar/page.tsx` (estado do dialog, `useApiMutation` → `POST /batches/:id/send-products` com `productIds` dos itens selecionados e `PENDING`, `invalidate: INV`, toast "N adicionados (M ignorados)", fecha o modal).
- **Testes:** `apps/web/test/queue-table-send-to-batch.test.tsx` (botão desabilitado/habilitado conforme seleção; chama o callback) e teste da página (mock `apiFetch`): seleciona produtos → abre modal → confirma → `POST` com body `{productIds, position}` correto e invalidação.

### T9 — verificação cruzada web
- `pnpm --filter @afilados/web exec vitest run` (suíte inteira, incluindo `batch-manage-drawer.test.tsx` com o WIP) e `typecheck`.

### T10 — Docker (obrigatório antes de concluir)
1. `pnpm typecheck && pnpm test` na raiz (Postgres/Redis no ar: `docker compose up -d --wait postgres redis`).
2. `docker compose up -d --build --wait` (api 3011, worker 3012, web 3010).
3. Validar **dentro do Docker**: criar lote A (concluído: enviar 1 item e deixar `DONE`) e lote B (rodando); salvar 3 produtos na triagem, selecionar, **Trazer selecionados para lote** → B com cada posição (conferir ordem no drawer) e → A (conferir `DONE→SCHEDULED/RUNNING` e envio real no próximo horário via logs do worker: `docker compose logs worker | grep send-offer`); lote pausado recebe e só agenda no "Retomar"; produtos somem da triagem; chamada duplicada não gera 500 (`skipped`).
4. Smoke de envio real no WhatsApp depende de sessão conectada do usuário (reportar se não puder ser feito).
5. Só então declarar concluído.

## Riscos
- Reagendar todos os pendentes a cada inserção re-enfileira jobs (aceitável para lotes de dezenas/centenas; `end` poderia otimizar tocando só nos novos — fora do MVP).
- Janela de operação: `DONE` reativado fora da janela espera a próxima abertura (esperado).
- WIP do drawer está não commitado na branch `feat/ai-cta`: commitar separadamente (ou em branch própria) antes de iniciar T3–T8 para não misturar históricos.
