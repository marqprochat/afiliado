# Extensão: enviar produto direto para um lote

**Data:** 2026-09-30
**Status:** aprovado para plano

## Objetivo

Permitir que a extensão Afilados Connect envie um produto capturado direto para um lote
de disparo já existente, em vez de passar pela Fila de Triagem. O produto entra como o
**próximo envio** do lote ("fura a fila"), e os demais itens pendentes são empurrados um
intervalo para frente.

## Contexto atual

- A extensão captura por dois pontos:
  - o **popup**, que já tem um seletor de destino (`#capture-target`) com "Fila de Triagem"
    ou uma automação (`automationRuleId`);
  - o **botão flutuante** da página de produto (`content.js`), que sempre manda para a
    Fila de Triagem.
- `POST /extension/capture` salva o produto (`upsertProducts`) e o coloca na Triagem
  (`QueueItem`) ou na fila da automação (`AutomationQueueItem`).
- Cada `BatchItem` vira um job BullMQ em `QUEUE_SEND_OFFER` com `jobId = batchItem.id` e
  `delay` calculado do `runAt`. A ordem real de envio vem dos horários (`runAt`), e o
  campo `order` só serve para exibir no painel.
- `POST /batches/:id/items` já adiciona produtos a um lote, mas só com o lote `PAUSED`, e
  usa a autenticação por cookie do painel. A extensão se autentica por token (`afil_…`)
  em `authenticateExtension`, por isso toda rota da extensão fica em `/extension/*`.

## Escopo

Aceita lotes ativos: `SCHEDULED`, `RUNNING` e `PAUSED`. Lotes `DONE` e `CANCELLED` não
aparecem na lista e são recusados pela API.

Fora do escopo: escolher a posição do item, adicionar vários produtos de uma vez pela
extensão e expor o "furar a fila" no painel web (a função fica pronta para isso).

## API

### `GET /extension/batches`

Autenticada por `authenticateExtension`. Retorna os lotes ativos do tenant, ordenados por
`createdAt desc`:

```ts
{ id: string; name: string; status: 'SCHEDULED' | 'RUNNING' | 'PAUSED'; pending: number }[]
```

`pending` é a quantidade de itens `PENDING`.

### `POST /extension/capture` com `batchId`

- `extensionCaptureSchema` (em `packages/shared/src/api.ts`) ganha `batchId?: string`.
  Enviar `batchId` e `automationRuleId` juntos dá erro de validação (refine).
- O fluxo de extração e salvamento do produto continua igual, e o tratamento de cupom
  também.
- Quando `batchId` vem preenchido:
  1. busca o lote do tenant com os itens. Se não existir, retorna 404 "Lote não
     encontrado". Se o status for `DONE` ou `CANCELLED`, retorna 409 "Lote não está
     ativo";
  2. chama `insertBatchItemNext`;
  3. **não** cria `QueueItem` de triagem;
  4. responde `{ ok: true, product, batchItem: { id, batchId, runAt } }`, com `runAt`
     nulo quando o lote está pausado.

### `insertBatchItemNext(db, tenantId, batch, productId, now = new Date())`

Fica em `apps/api/src/lib/batches.ts`. `batch` já vem com `items` ordenados por `order`.

1. **Duplicado:** se já existe item `PENDING` ou `SENDING` desse produto no lote,
   lança 409 "Produto já está neste lote". Em outros lotes o produto pode entrar,
   porque o destino foi escolhido explicitamente.
2. **Ordem:** a nova ordem é `base = max(order dos itens não pendentes) + 1`. O novo
   item recebe `base`, e cada pendente recebe `base + 1 + índice`, mantendo a ordem
   relativa entre eles. O mesmo esquema de `PUT /batches/:id/order`.
3. **Lote `PAUSED`:** cria o item com a ordem acima e `runAt = now`. Não enfileira nada;
   o "Retomar" já agenda todos os pendentes na ordem certa.
4. **Lote `SCHEDULED`/`RUNNING`:**
   - `startAt`:
     - com itens pendentes, é o `runAt` do primeiro pendente, ou `now` se esse horário
       já passou;
     - sem pendentes, é o `runAt` do último item enviado mais `intervalMin`, ou `now`,
       o que for mais tarde;
   - remove os jobs pendentes (`removePendingJobs`); o job `active` segue intocado;
   - calcula `scheduleBatch(pending.length + 1, intervalMin, window, startAt)` com a
     janela de operação do tenant (`getOperatingWindow` + `toCoreWindow`);
   - numa transação, cria o novo item e atualiza `order` e `runAt` de todos os
     pendentes;
   - atualiza o lote com `estimatedEndAt` igual ao último `runAt`. Se o status era
     `RUNNING`, ele não muda;
   - enfileira `[novo, ...pendentes]` com `enqueueBatchItems`;
   - se o enfileiramento falhar, coloca o lote em `PAUSED` (como o "Retomar" faz) e
     lança 500 "Falha ao enfileirar lote". Os itens continuam `PENDING` e o usuário
     retoma pelo painel.
5. Publica `batch.progress` com o `total` atualizado para o painel refletir em tempo
   real.

## Extensão

### Popup (`popup.html` / `popup.js`)

- `loadAutomationTargets` passa a se chamar `loadCaptureTargets` e busca, em paralelo,
  `/extension/automations` e `/extension/batches`.
- O seletor mostra "Fila de Triagem" no topo, depois o `<optgroup label="Automações">`
  e o `<optgroup label="Lotes">`. Cada lote aparece como
  `Nome (agendado|rodando|pausado · N pendentes)`.
- O valor das opções ganha prefixo de tipo: `rule:<id>` e `batch:<id>`.
  - Um `lastCaptureTarget` antigo, sem prefixo, é lido como `rule:<id>`.
  - Se o destino salvo não existe mais na lista, o seletor volta para a Fila de Triagem.
- O seletor aparece sempre que houver automação **ou** lote ativo.
- O botão mostra o destino: "⚡ Enviar para Fila de Triagem", "⚡ Enviar para: <automação>"
  ou "⚡ Enviar para lote: <nome>".
- Na captura, `batch:<id>` vira `batchId` e `rule:<id>` vira `automationRuleId` no
  payload.
- Em caso de sucesso num lote, a mensagem é "✅ Adicionado como próximo envio de <lote>".
  Se o lote estiver pausado, a mensagem diz que ele sai primeiro quando o lote for
  retomado.
- O destino escolhido é salvo em `chrome.storage.local`:
  `lastCaptureTarget = { value, label }`. O `label` serve para o botão flutuante mostrar
  o destino sem precisar buscar a lista.

### Botão flutuante (`content.js`)

- Lê `lastCaptureTarget` do `chrome.storage.local` e monta o payload como o popup:
  `batchId` ou `automationRuleId`.
- O rótulo do botão mostra o destino quando ele não é a Triagem, por exemplo
  "Capturar → Lote Ofertas noite". O rótulo é atualizado quando o storage muda
  (`chrome.storage.onChanged`).
- Se a API responder 404 ou 409 de lote (lote inativo ou removido), o botão:
  - refaz a captura sem destino, ou seja, na Fila de Triagem;
  - mostra "Lote indisponível, enviado para a Triagem";
  - limpa o `lastCaptureTarget`.
- 409 de produto duplicado mostra "Já está neste lote" e não refaz a captura.

## Erros

| Situação | Resposta |
|---|---|
| `batchId` e `automationRuleId` juntos | 400 VALIDATION |
| Lote não existe no tenant | 404 "Lote não encontrado" |
| Lote `DONE`/`CANCELLED` | 409 "Lote não está ativo" |
| Produto já pendente ou em envio no lote | 409 "Produto já está neste lote" |
| Falha ao enfileirar | lote vai para `PAUSED`, 500 "Falha ao enfileirar lote" |

Para a extensão distinguir os dois 409, cada um usa um código de `ApiError` próprio:
`BATCH_INACTIVE` e `BATCH_DUPLICATE`.

## Testes

API (vitest, no padrão de `apps/api/test/batches.test.ts` e `extension-discover.test.ts`):

- `GET /extension/batches` lista só lotes ativos, com a contagem de `pending`.
- Captura com `batchId` num lote `PAUSED`:
  - o item é criado como primeiro pendente e os demais sobem uma posição;
  - nenhum job é enfileirado.
- Captura com `batchId` num lote `SCHEDULED`:
  - o novo item recebe o horário do antigo primeiro pendente e os demais são empurrados
    um intervalo;
  - os jobs são removidos e reenfileirados;
  - o `estimatedEndAt` é atualizado.
- Lote sem pendentes (`RUNNING` com o último item já enviado): o novo item fica em
  `último envio + intervalo`.
- Produto duplicado retorna 409 `BATCH_DUPLICATE`, lote cancelado retorna 409
  `BATCH_INACTIVE` e lote de outro tenant retorna 404.
- `batchId` + `automationRuleId` retorna 400.
- A captura com `batchId` não cria `QueueItem`.

Extensão: não tem suíte automatizada. Validação manual com o zip gerado por
`apps/extension/build.js`:

- captura pelo popup para um lote rodando e para um lote pausado;
- captura pelo botão flutuante usando o último destino;
- fallback para a Triagem quando o lote é cancelado.

Antes de concluir, a validação completa roda no Docker (API rebuildada).
