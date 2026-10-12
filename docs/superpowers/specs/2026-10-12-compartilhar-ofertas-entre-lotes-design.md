# Compartilhar ofertas entre lotes — Design

**Data:** 2026-10-12
**Status:** aprovado

## Objetivo

1. Na triagem, o botão **"Trazer selecionados para lote"** passa a aceitar **vários lotes** destino de uma vez (inclusive lotes em andamento).
2. De **dentro de um lote** (drawer "Gerenciar"), compartilhar ofertas para a fila de outro(s) lote(s) **sem precisar pausar** o lote de origem.

## Decisões

| Tema | Decisão |
| --- | --- |
| Semântica | **Copiar**: o item continua no lote de origem e também entra no(s) destino(s). |
| Itens compartilháveis (drawer) | Qualquer item **de produto** (PENDING, SENDING, SENT, ERROR). Cupons e mensagens livres ficam de fora. |
| UI no drawer | Checkbox por item de produto + botão "Compartilhar selecionados (N)". Funciona em qualquer status do lote de origem, sem pausar. |
| Vários destinos | Uma posição única (fim / começo / embaralhar) aplicada a todos os lotes marcados. |
| Backend | Rota nova `POST /batches/share` (loop server-side sobre `addProductsToBatch`). |

## Contexto existente

- `addProductsToBatch` (`apps/api/src/lib/batches.ts`): insere N produtos num lote SCHEDULED/RUNNING/PAUSED/DONE com posição, pula produtos já presentes (qualquer status), reativa DONE→SCHEDULED, rejeita CANCELLED (409 `BATCH_INACTIVE`).
- `POST /batches/:id/send-products` (`apps/api/src/routes/batches.ts`): valida tenant + `PENDING_ENRICH` e chama `addProductsToBatch` para **um** lote.
- `SendToBatchDialog` (`apps/web/src/components/queue/send-to-batch-dialog.tsx`): 2 passos, radio de lote único, posição.
- `BatchManageDrawer` (`apps/web/src/components/queue/batch-manage-drawer.tsx`): edição (ordem, remover, incluir) só com lote pausado.
- `GET /queue` oculta produtos que estão em lote não cancelado — por isso, depois que o produto entra num lote, não dá mais para mandá-lo a outro pela triagem. O compartilhamento pelo drawer resolve isso.
- `BatchItem` tem `@@unique([batchId, productId])`; o mesmo produto em lotes diferentes é permitido.

## Backend

### Contrato

`packages/shared/src/api.ts`:

```ts
export const batchShareSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(500),
  batchIds: z.array(z.string().min(1)).min(1).max(20),
  position: z.enum(BATCH_POSITIONS).default('end'),
});
export type BatchShareBody = z.infer<typeof batchShareSchema>;
```

`POST /api/v1/batches/share` (autenticada, tenant):

- 200: `{ results: Array<{ batchId: string; ok: boolean; added: number; skipped: number; reactivated: boolean; status: BatchStatus | null; error: { code: string; message: string } | null }> }` — um resultado por lote, na ordem de `batchIds` deduplicado.
- 400: body inválido.
- 404: algum produto ou algum lote não pertence ao tenant (validação prévia, nada é gravado).
- 409 `PRODUCT_NOT_READY`: algum produto com `QueueItem.status = PENDING_ENRICH` (validação prévia, nada é gravado).

### Fluxo

1. Parse do body; deduplicar `productIds` e `batchIds`.
2. Validar produtos do tenant (404) e `PENDING_ENRICH` (409) — mesma lógica do `send-products`, extraída para um helper compartilhado `assertProductsSendable(db, tenantId, productIds)`.
3. Carregar todos os lotes (`where: { id: { in }, tenantId }`, com itens ordenados por `order`, mesmo select do `findBatch`); se faltar algum ⇒ 404.
4. Janela de operação carregada uma vez.
5. Para cada lote, **sequencialmente** (evita disputa no Redis/DB e mantém o resultado determinístico): `try { addProductsToBatch(...) } catch (err) { results.push({ ok: false, error }) }`. `ApiError` vira `{code, message}`; erro desconhecido vira `INTERNAL` e é logado.
6. Para cada lote com `ok`: publicar `batch.progress`. Ao final: um `queue.updated` e o `enqueueMlLinksPrewarm` (sem await, como hoje).
7. Responder `results`.

`send-products` passa a usar `assertProductsSendable` (sem mudar contrato). Worker não muda.

### Casos de borda

- Lote destino CANCELLED: `ok:false`, `BATCH_INACTIVE`; os demais seguem.
- Produto já presente no destino (qualquer status): conta em `skipped`.
- Lote destino DONE: reativado (`reactivated: true`).
- Lote destino PAUSED: só cria/reordena; agenda no "Retomar".
- Lote de origem incluído em `batchIds` (chamada direta da API): produtos já presentes ⇒ `skipped`, sem erro.
- Falha de enfileiramento num lote: `addProductsToBatch` já pausa aquele lote e lança `INTERNAL`; vira `ok:false` para ele.

## Frontend

### Tipos e helper

- `apps/web/src/lib/types.ts`: `BatchShareResult`, `BatchShareResponse`.
- Helper puro `summarizeShare(results, batches)` (em `apps/web/src/lib/batch-target.ts`) que devolve `{ added, skipped, okCount, failed: Array<{ name, message }> }` para montar os toasts.

### `SendToBatchDialog`

- Passo 1: **checkbox** por lote (antes radio); "Avançar" exige ≥ 1 marcado. Nova prop `excludeBatchIds?: string[]` filtra lotes da lista (usada pelo drawer para esconder o lote de origem).
- Passo 2: resumo `Enviar N produto(s) para «A», «B»`; aviso de reativação listando os lotes `DONE` marcados (se houver); posição única (padrão `end`).
- `onConfirm({ batchIds: string[], position })`.
- Ao abrir: volta ao passo 1, posição `end`, seleção de lotes limpa.
- Título/descrição genéricos ("Enviar produtos para lotes"), pois o modal passa a ser usado pela triagem e pelo drawer.

### Triagem (`enviar/page.tsx`)

- `sendToBatch` passa a chamar `POST /batches/share` com `{ productIds: selecionados PENDING, batchIds, position }`.
- Toast de sucesso: `X adicionado(s) em K lote(s)` + ` (Y ignorado(s))` se houver. Para cada falha: `toast.error("«Nome»: mensagem")`. Fecha o modal se ao menos um lote deu certo; se todos falharam, mantém aberto.

### Drawer do lote (`batch-manage-drawer.tsx`)

- Estado `shareSelected: Set<string>` (productIds) guardado no `BatchManageDrawer` (fora do `ItemsSection`, que é remontado pela `key` quando a assinatura dos itens muda), filtrado pelos productIds ainda presentes no lote. Independente do estado de ordenação/drag.
- Checkbox (`NativeCheckbox`, `aria-label="Selecionar «título»"`) em toda linha cujo item tem `productId` e `product`, em qualquer status do lote e do item. Linhas de cupom/mensagem não têm checkbox.
- Botão "Compartilhar selecionados (N)" no cabeçalho da fila, desabilitado com 0 selecionados; abre `SendToBatchDialog` com `excludeBatchIds=[batch.id]`, `batches` de `useBatches()` e `count = N`.
- Confirmação chama `POST /batches/share`, mesmos toasts da triagem, invalida `['batches'], ['overview'], ['queue']`, limpa a seleção e fecha o modal.
- A `DrawerDescription` de lote rodando passa a mencionar que dá para compartilhar ofertas sem pausar.

## Testes

**API (integração, Postgres + Redis reais)** — `apps/api/test/batch-share.test.ts`:
1. Dois lotes rodando: produtos entram nos dois, jobs enfileirados nos dois, `results` com `ok:true`.
2. Um destino CANCELLED + um rodando: CANCELLED `ok:false BATCH_INACTIVE`, o outro `ok:true` e gravado.
3. Produto já no destino (inclusive `SENT`): `skipped`, sem 500.
4. Destino DONE: `reactivated:true`, status `SCHEDULED`.
5. Compartilhar a partir de um lote: produto continua no lote de origem (cópia) e aparece no destino.
6. Lote ou produto de outro tenant: 404, nada gravado.
7. Produto `PENDING_ENRICH`: 409, nada gravado.
8. Regressão: `batch-send-products.test.ts`, `batches.test.ts`, `extension-batch.test.ts` verdes.

**Shared**: `batchShareSchema` aceita/rejeita (listas vazias, >20 lotes, posição inválida).

**Web**:
- `send-to-batch-dialog.test.tsx`: múltipla seleção; `excludeBatchIds`; aviso DONE lista os lotes concluídos; `onConfirm` com `batchIds` + posição.
- `batch-target.test.ts`: `summarizeShare`.
- Drawer: lote RUNNING mostra checkbox nos itens de produto e não nos de cupom; botão desabilitado com 0; confirmar faz `POST /batches/share` sem o lote de origem na lista.
- `enviar-page.test.tsx`: fluxo com 2 lotes → POST `/batches/share` com body correto.

**Docker (obrigatório antes de concluir)**: typecheck + testes no servidor via `.superpowers/sdd/remote.sh`; `docker compose up -d --build --wait`; validar: triagem → 2 lotes rodando; drawer de lote rodando → compartilhar para outro lote sem pausar (origem mantém o item; destino recebe e agenda); destino concluído é reativado.

## Fora de escopo

- Compartilhar cupons e mensagens livres.
- Posição diferente por lote destino.
- Extensão do Chrome.
- "Mover" (remover da origem).
