# Compartilhar ofertas entre lotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir enviar produtos para vários lotes de uma vez — a partir da triagem ("Trazer selecionados para lote") e de dentro do drawer de um lote, sem pausá-lo.

**Architecture:** Rota nova `POST /batches/share` que valida uma vez e chama o `addProductsToBatch` existente para cada lote destino (sequencial, falha isolada por lote). O `SendToBatchDialog` passa de seleção única (radio) para múltipla (checkbox) e é reaproveitado pelo drawer, com um hook `useShareToBatches` compartilhado pelos dois pontos de entrada. O worker não muda.

**Tech Stack:** TypeScript, Fastify + Prisma + BullMQ (api), zod (`@afilados/shared`), Next.js/React + TanStack Query + base-ui (web), Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-10-12-compartilhar-ofertas-entre-lotes-design.md`

## Global Constraints

- Semântica **copiar**: o item continua no lote de origem.
- Drawer: checkbox só em itens **de produto** (`productId` e `product` presentes), em qualquer status do lote e do item; cupons e mensagens livres não têm checkbox.
- Uma única posição (`'shuffle' | 'start' | 'end'`, padrão `'end'`) para todos os lotes destino.
- `batchIds` de 1 a 20; `productIds` de 1 a 500.
- Texto da UI em português; testes web em `apps/web/test`, testes da api em `apps/api/test`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Testes da api precisam de Postgres e Redis: rodar no servidor Linux com `.superpowers/sdd/remote.sh` (`up` e `setup` uma vez; depois `run <comando>`). Testes de `packages/shared` e `apps/web` rodam localmente.
- Antes de declarar concluído: validar no Docker (Task 7).

## Ordem e paralelismo

```
T1 shared ──► T2 api
T3 web helper ─► T4 dialog ─► T5 hook + triagem ─► T6 drawer ─► T7 Docker
```
T1→T2 (backend) e T3→T4 (frontend) são independentes e podem ser feitos em paralelo; T5 em diante exige T3 e T4.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/shared/src/api.ts` | `batchShareSchema` / `BatchShareBody` |
| `apps/api/src/lib/batches.ts` | helper `assertProductsSendable` |
| `apps/api/src/routes/batches.ts` | rota `POST /batches/share`; `send-products` passa a usar o helper |
| `apps/api/test/batch-share.test.ts` | integração da rota nova |
| `apps/web/src/lib/types.ts` | `BatchShareResult`, `BatchShareResponse` |
| `apps/web/src/lib/batch-target.ts` | `summarizeShare` |
| `apps/web/src/lib/use-share-to-batches.ts` | hook de mutation + toasts (novo) |
| `apps/web/src/components/queue/send-to-batch-dialog.tsx` | seleção múltipla + `excludeBatchIds` |
| `apps/web/src/app/(app)/enviar/page.tsx` | triagem usa o hook |
| `apps/web/src/components/queue/batch-manage-drawer.tsx` | checkboxes + botão "Compartilhar selecionados" |

---

### Task 1: Schema `batchShareSchema` (shared)

**Files:**
- Modify: `packages/shared/src/api.ts` (logo após `BatchSendProductsBody`, ~linha 197)
- Test: `packages/shared/test/api.test.ts`

**Interfaces:**
- Produces: `batchShareSchema` (zod) e `type BatchShareBody = { productIds: string[]; batchIds: string[]; position: 'shuffle'|'start'|'end' }`, exportados por `@afilados/shared`.

- [ ] **Step 1: Write the failing test**

Em `packages/shared/test/api.test.ts`, acrescente `batchShareSchema` ao import que já traz `batchSendProductsSchema` e adicione, dentro do `describe('api schemas', ...)`, ao lado do `describe('batchSendProductsSchema', ...)`:

```ts
  describe('batchShareSchema', () => {
    it('aceita produtos e lotes e defaulta position para end', () => {
      const r = batchShareSchema.parse({ productIds: ['p1'], batchIds: ['b1', 'b2'] });
      expect(r.position).toBe('end');
      expect(r.batchIds).toEqual(['b1', 'b2']);
    });
    it('aceita as 3 posições', () => {
      for (const position of ['shuffle', 'start', 'end'] as const) {
        expect(
          batchShareSchema.parse({ productIds: ['p1'], batchIds: ['b1'], position }).position,
        ).toBe(position);
      }
    });
    it('rejeita productIds ou batchIds vazios', () => {
      expect(batchShareSchema.safeParse({ productIds: [], batchIds: ['b1'] }).success).toBe(false);
      expect(batchShareSchema.safeParse({ productIds: ['p1'], batchIds: [] }).success).toBe(false);
    });
    it('rejeita mais de 20 lotes e posição inválida', () => {
      const many = Array.from({ length: 21 }, (_, i) => `b${i}`);
      expect(batchShareSchema.safeParse({ productIds: ['p1'], batchIds: many }).success).toBe(false);
      expect(
        batchShareSchema.safeParse({ productIds: ['p1'], batchIds: ['b1'], position: 'meio' })
          .success,
      ).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/shared exec vitest run test/api.test.ts`
Expected: FAIL (`batchShareSchema` is not defined / undefined import).

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/api.ts`, depois de `export type BatchSendProductsBody = ...;`:

```ts
export const batchShareSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(500),
  batchIds: z.array(z.string().min(1)).min(1).max(20),
  position: z.enum(BATCH_POSITIONS).default('end'),
});
export type BatchShareBody = z.infer<typeof batchShareSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/shared exec vitest run test/api.test.ts`
Expected: PASS. Depois: `pnpm --filter @afilados/shared typecheck` sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/test/api.test.ts
git commit -m "feat(shared): schema batchShareSchema

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rota `POST /batches/share` (api)

**Files:**
- Modify: `apps/api/src/lib/batches.ts` (adicionar `assertProductsSendable` antes de `removeStaleJobs`)
- Modify: `apps/api/src/routes/batches.ts` (imports; `send-products` usa o helper; rota nova logo após `send-products`)
- Test: `apps/api/test/batch-share.test.ts` (novo)

**Interfaces:**
- Consumes: `batchShareSchema` (Task 1); `addProductsToBatch` e `batchItemPublicSelect` de `../lib/batches`.
- Produces: `POST /api/v1/batches/share` com body `{ productIds, batchIds, position }` e resposta `{ results: Array<{ batchId: string; ok: boolean; added: number; skipped: number; reactivated: boolean; status: BatchStatus | null; error: { code: string; message: string } | null }> }`. Erros prévios (nada é gravado): 404 (produto/lote inexistente no tenant), 409 `PRODUCT_NOT_READY`.

- [ ] **Step 1: Write the failing integration tests**

Crie `apps/api/test/batch-share.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const MIN = 60_000;

describe('POST /api/v1/batches/share', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let otherT: Awaited<ReturnType<typeof createTenantWithUser>>;
  let cookie: string;
  let sessionId: string;
  let templateId: string;
  let n = 0;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Share');
    otherT = await createTenantWithUser('Outro Tenant Share');
    await prisma.operatingWindow.update({
      where: { tenantId: t.tenantId },
      data: { enabled: false },
    });
    cookie = await loginCookie(app, t.email, t.password);
    const session = await prisma.waSession.create({
      data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
    });
    sessionId = session.id;
    templateId = (await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })).id;
  });

  afterEach(async () => {
    const items = await prisma.batchItem.findMany({
      where: { batch: { tenantId: t.tenantId } },
      select: { id: true },
    });
    const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
    await Promise.all(items.map((i) => q.getJob(i.id).then((j) => j?.remove().catch(() => {}))));
    await cleanupTenant(t.tenantId);
    await cleanupTenant(otherT.tenantId);
    await app.close();
  });

  async function makeProduct(
    tenantId = t.tenantId,
    status: 'PENDING' | 'PENDING_ENRICH' = 'PENDING',
  ) {
    n++;
    const p = await prisma.product.create({
      data: {
        tenantId,
        source: 'MAGALU',
        externalId: `share-${n}-${Date.now()}`,
        title: `Produto ${n}`,
        price: 10 * n,
        images: [],
        originalUrl: `https://www.magazineluiza.com.br/produto-${n}/p/abc${n}/`,
        raw: {},
      },
    });
    await prisma.queueItem.create({ data: { tenantId, productId: p.id, status } });
    return p;
  }

  async function makeBatch(
    status: 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'CANCELLED',
    pendingCount: number,
    opts: { sent?: number } = {},
  ) {
    const intervalMin = 10;
    const first = new Date(Date.now() + 30 * MIN);
    const batch = await prisma.batch.create({
      data: {
        tenantId: t.tenantId,
        sessionId,
        templateId,
        name: `Lote ${status} ${n++}`,
        groupJids: ['g1@g.us'],
        intervalMin,
        status,
      },
    });
    let order = 0;
    const sent = opts.sent ?? 0;
    for (let i = 0; i < sent; i++) {
      const p = await makeProduct();
      await prisma.batchItem.create({
        data: {
          batchId: batch.id,
          productId: p.id,
          order: order++,
          status: 'SENT',
          runAt: new Date(first.getTime() - (sent - i) * intervalMin * MIN),
        },
      });
    }
    const pendingItems = [];
    for (let i = 0; i < pendingCount; i++) {
      const p = await makeProduct();
      pendingItems.push(
        await prisma.batchItem.create({
          data: {
            batchId: batch.id,
            productId: p.id,
            order: order++,
            status: 'PENDING',
            runAt: new Date(first.getTime() + i * intervalMin * MIN),
          },
        }),
      );
    }
    return { batch, pendingItems };
  }

  const share = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/batches/share',
      headers: { cookie },
      payload: payload as Record<string, unknown>,
    });

  const countItems = (batchId: string) => prisma.batchItem.count({ where: { batchId } });

  it('adiciona os produtos nos dois lotes e enfileira os jobs', async () => {
    const { batch: a } = await makeBatch('RUNNING', 1);
    const { batch: b } = await makeBatch('RUNNING', 2);
    const p1 = await makeProduct();
    const p2 = await makeProduct();

    const res = await share({ productIds: [p1.id, p2.id], batchIds: [a.id, b.id], position: 'end' });

    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(
      results.map((r: { batchId: string; ok: boolean; added: number }) => [r.batchId, r.ok, r.added]),
    ).toEqual([
      [a.id, true, 2],
      [b.id, true, 2],
    ]);
    expect(await countItems(a.id)).toBe(3);
    expect(await countItems(b.id)).toBe(4);

    const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
    const newItems = await prisma.batchItem.findMany({
      where: { productId: { in: [p1.id, p2.id] } },
    });
    expect(newItems).toHaveLength(4);
    for (const it of newItems) expect(await q.getJob(it.id)).not.toBeNull();
  });

  it('um lote cancelado falha sozinho e os outros continuam', async () => {
    const { batch: cancelled } = await makeBatch('CANCELLED', 0);
    const { batch: running } = await makeBatch('RUNNING', 1);
    const p = await makeProduct();

    const res = await share({ productIds: [p.id], batchIds: [cancelled.id, running.id] });

    expect(res.statusCode).toBe(200);
    const [r1, r2] = res.json().results;
    expect(r1).toMatchObject({ batchId: cancelled.id, ok: false, added: 0 });
    expect(r1.error.code).toBe('BATCH_INACTIVE');
    expect(r2).toMatchObject({ batchId: running.id, ok: true, added: 1, error: null });
    expect(await countItems(cancelled.id)).toBe(0);
    expect(await countItems(running.id)).toBe(2);
  });

  it('produto já presente no lote (inclusive SENT) é pulado sem erro', async () => {
    const { batch } = await makeBatch('RUNNING', 1, { sent: 1 });
    const sentItem = await prisma.batchItem.findFirstOrThrow({
      where: { batchId: batch.id, status: 'SENT' },
    });

    const res = await share({ productIds: [sentItem.productId], batchIds: [batch.id] });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ ok: true, added: 0, skipped: 1 });
    expect(await countItems(batch.id)).toBe(2);
  });

  it('lote concluído é reativado', async () => {
    const { batch } = await makeBatch('DONE', 0, { sent: 2 });
    const p = await makeProduct();

    const res = await share({ productIds: [p.id], batchIds: [batch.id] });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({
      ok: true,
      added: 1,
      reactivated: true,
      status: 'SCHEDULED',
    });
    const fresh = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(fresh.status).toBe('SCHEDULED');
  });

  it('copia: o produto compartilhado continua no lote de origem', async () => {
    const { batch: origin, pendingItems } = await makeBatch('RUNNING', 2);
    const { batch: target } = await makeBatch('RUNNING', 1);
    const productId = pendingItems[0]!.productId!;

    const res = await share({ productIds: [productId], batchIds: [target.id], position: 'start' });

    expect(res.statusCode).toBe(200);
    expect(await countItems(origin.id)).toBe(2);
    const inTarget = await prisma.batchItem.findMany({ where: { batchId: target.id } });
    expect(inTarget.map((i) => i.productId)).toContain(productId);
    expect(inTarget).toHaveLength(2);
  });

  it('404 sem gravar nada quando o produto é de outro tenant', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const foreign = await makeProduct(otherT.tenantId);

    const res = await share({ productIds: [foreign.id], batchIds: [batch.id] });

    expect(res.statusCode).toBe(404);
    expect(await countItems(batch.id)).toBe(1);
  });

  it('404 quando algum lote não existe, sem gravar nos outros', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const p = await makeProduct();

    const res = await share({ productIds: [p.id], batchIds: [batch.id, 'lote-inexistente'] });

    expect(res.statusCode).toBe(404);
    expect(await countItems(batch.id)).toBe(1);
  });

  it('409 quando o produto ainda está sendo enriquecido', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const p = await makeProduct(t.tenantId, 'PENDING_ENRICH');

    const res = await share({ productIds: [p.id], batchIds: [batch.id] });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PRODUCT_NOT_READY');
    expect(await countItems(batch.id)).toBe(1);
  });
});
```

Antes de salvar, abra `apps/api/test/batch-send-products.test.ts` e confira como os testes de 409/404 lêem o corpo de erro (o caminho do código no JSON, `res.json().error.code`). Ajuste os `expect` acima se o formato for diferente.

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/batch-share.test.ts`
Expected: FAIL (rota inexistente → 404 nos casos felizes).

- [ ] **Step 3: Write minimal implementation**

3a. `apps/api/src/lib/batches.ts` — adicionar antes de `removeStaleJobs`:

```ts
/** Garante que os produtos existem no tenant e já saíram do enriquecimento (podem ser enviados). */
export async function assertProductsSendable(
  db: TenantClient,
  tenantId: string,
  productIds: string[],
) {
  const products = await db.product.findMany({
    where: { id: { in: productIds }, tenantId },
    select: { id: true },
  });
  if (products.length < productIds.length) {
    throw ApiError.notFound('Produto não encontrado');
  }
  const queueItems = await db.queueItem.findMany({
    where: { productId: { in: productIds }, tenantId },
    select: { status: true },
  });
  if (queueItems.some((q) => q.status === 'PENDING_ENRICH')) {
    throw new ApiError(
      'PRODUCT_NOT_READY',
      'Algum produto selecionado ainda está sendo enriquecido',
      409,
    );
  }
}
```

3b. `apps/api/src/routes/batches.ts`:

- Imports: adicionar `batchShareSchema` e `type BatchStatus` ao import de `@afilados/shared`; `assertProductsSendable` ao import de `../lib/batches`.
- Na rota `send-products`, trocar o bloco que busca `products` e `queueItems` (da linha `const products = await req.db.product.findMany(` até o `}` do `if (queueItems.some(...))`) por:

```ts
    await assertProductsSendable(req.db, req.tenantId, uniqueProductIds);
```

- Logo após o fim da rota `send-products` (depois do `});` que fecha o handler), adicionar:

```ts
  app.post('/batches/share', async (req) => {
    const body = batchShareSchema.parse(req.body);
    const productIds = [...new Set(body.productIds)];
    const batchIds = [...new Set(body.batchIds)];

    await assertProductsSendable(req.db, req.tenantId, productIds);

    const batches = await req.db.batch.findMany({
      where: { id: { in: batchIds } },
      include: { items: { orderBy: { order: 'asc' }, select: batchItemPublicSelect } },
    });
    if (batches.length < batchIds.length) throw ApiError.notFound('Lote não encontrado');
    const byId = new Map(batches.map((b) => [b.id, b]));

    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));

    type ShareResult = {
      batchId: string;
      ok: boolean;
      added: number;
      skipped: number;
      reactivated: boolean;
      status: BatchStatus | null;
      error: { code: string; message: string } | null;
    };
    const results: ShareResult[] = [];

    for (const batchId of batchIds) {
      const b = byId.get(batchId)!;
      try {
        const res = await addProductsToBatch({
          db: req.db,
          tenantId: req.tenantId,
          batch: b,
          productIds,
          position: body.position,
          window,
        });
        results.push({
          batchId,
          ok: true,
          added: res.added,
          skipped: res.skipped,
          reactivated: res.reactivated,
          status: res.status,
          error: null,
        });
        await app.events.publish(req.tenantId, {
          type: 'batch.progress',
          batchId,
          sent: b.items.filter((i) => i.status === 'SENT').length,
          total: b.items.length + res.added,
          estimatedEndAt: res.estimatedEndAt ? res.estimatedEndAt.toISOString() : '',
        });
      } catch (err) {
        const error =
          err instanceof ApiError
            ? { code: err.code, message: err.message }
            : { code: 'INTERNAL', message: 'Falha ao adicionar ao lote' };
        if (!(err instanceof ApiError)) {
          req.log.error({ err, batchId }, 'falha ao compartilhar com o lote');
        }
        results.push({
          batchId,
          ok: false,
          added: 0,
          skipped: 0,
          reactivated: false,
          status: null,
          error,
        });
      }
    }

    // sem await: com o Redis fora do ar o enfileiramento ficaria pendurado e atrasaria a resposta
    void enqueueMlLinksPrewarm(req.db, req.tenantId, productIds).catch((err) =>
      req.log.warn({ err }, 'falha ao enfileirar o pré-aquecimento de links do ML'),
    );
    await app.events.publish(req.tenantId, { type: 'queue.updated' });

    return { results };
  });
```

Se `ApiError` não expuser `.code` como propriedade pública, abra a definição de `ApiError` em `packages/shared/src` e use o nome real da propriedade.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/batch-share.test.ts test/batch-send-products.test.ts test/batches.test.ts test/extension-batch.test.ts
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api typecheck
```
Expected: todos PASS (os três arquivos antigos provam que o refactor do helper não regrediu) e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/batches.ts apps/api/src/routes/batches.ts apps/api/test/batch-share.test.ts
git commit -m "feat(api): POST /batches/share para vários lotes de uma vez

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tipos e `summarizeShare` (web)

**Files:**
- Modify: `apps/web/src/lib/types.ts` (após `BatchSendProductsBody`, ~linha 274)
- Modify: `apps/web/src/lib/batch-target.ts`
- Test: `apps/web/test/batch-target.test.ts`

**Interfaces:**
- Produces:
  - `interface BatchShareResult { batchId: string; ok: boolean; added: number; skipped: number; reactivated: boolean; status: BatchStatus | null; error: { code: string; message: string } | null }`
  - `interface BatchShareResponse { results: BatchShareResult[] }`
  - `summarizeShare(results: BatchShareResult[], batches: Array<{ id: string; name: string }>): { added: number; skipped: number; okCount: number; failed: Array<{ name: string; message: string }> }`

- [ ] **Step 1: Write the failing test**

Acrescente em `apps/web/test/batch-target.test.ts` (importe `summarizeShare` junto de `eligibleBatches`):

```ts
describe('summarizeShare', () => {
  const batches = [
    { id: 'b1', name: 'Lote A' },
    { id: 'b2', name: 'Lote B' },
  ];
  const ok = (batchId: string, added: number, skipped = 0) => ({
    batchId,
    ok: true,
    added,
    skipped,
    reactivated: false,
    status: 'RUNNING' as const,
    error: null,
  });

  it('soma adicionados/ignorados dos lotes que deram certo', () => {
    expect(summarizeShare([ok('b1', 2, 1), ok('b2', 3)], batches)).toEqual({
      added: 5,
      skipped: 1,
      okCount: 2,
      failed: [],
    });
  });

  it('lista as falhas com o nome do lote e a mensagem', () => {
    const failed = {
      batchId: 'b2',
      ok: false,
      added: 0,
      skipped: 0,
      reactivated: false,
      status: null,
      error: { code: 'BATCH_INACTIVE', message: 'Lote cancelado não pode receber produtos' },
    };
    expect(summarizeShare([ok('b1', 1), failed], batches)).toEqual({
      added: 1,
      skipped: 0,
      okCount: 1,
      failed: [{ name: 'Lote B', message: 'Lote cancelado não pode receber produtos' }],
    });
  });

  it('usa o id quando o lote não está na lista', () => {
    const failed = {
      batchId: 'zz',
      ok: false,
      added: 0,
      skipped: 0,
      reactivated: false,
      status: null,
      error: { code: 'INTERNAL', message: 'Falha' },
    };
    expect(summarizeShare([failed], batches).failed).toEqual([{ name: 'zz', message: 'Falha' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/batch-target.test.ts`
Expected: FAIL (`summarizeShare` não exportado).

- [ ] **Step 3: Write minimal implementation**

3a. `apps/web/src/lib/types.ts`, após `BatchSendProductsBody`:

```ts
export interface BatchShareResult {
  batchId: string;
  ok: boolean;
  added: number;
  skipped: number;
  reactivated: boolean;
  status: BatchStatus | null;
  error: { code: string; message: string } | null;
}
export interface BatchShareResponse {
  results: BatchShareResult[];
}
```

3b. `apps/web/src/lib/batch-target.ts`: ajuste o import para `import type { BatchShareResult, BatchSummary, EligibleBatch } from './types';` e acrescente no fim do arquivo:

```ts
/** Resume o retorno de POST /batches/share para montar os toasts. */
export function summarizeShare(
  results: BatchShareResult[],
  batches: Array<{ id: string; name: string }>,
) {
  const nameOf = (id: string) => batches.find((b) => b.id === id)?.name ?? id;
  let added = 0;
  let skipped = 0;
  let okCount = 0;
  const failed: Array<{ name: string; message: string }> = [];
  for (const r of results) {
    if (r.ok) {
      okCount++;
      added += r.added;
      skipped += r.skipped;
    } else {
      failed.push({ name: nameOf(r.batchId), message: r.error?.message ?? 'Erro inesperado' });
    }
  }
  return { added, skipped, okCount, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/web exec vitest run test/batch-target.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/batch-target.ts apps/web/test/batch-target.test.ts
git commit -m "feat(web): tipos e summarizeShare para compartilhar entre lotes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `SendToBatchDialog` com seleção múltipla

**Files:**
- Modify (reescrever): `apps/web/src/components/queue/send-to-batch-dialog.tsx`
- Test: `apps/web/test/send-to-batch-dialog.test.tsx`

**Interfaces:**
- Consumes: `eligibleBatches` (`@/lib/batch-target`).
- Produces: `SendToBatchDialogProps` com `onConfirm: (params: { batchIds: string[]; position: BatchPosition }) => void | Promise<void>` e `excludeBatchIds?: string[]` (as demais props não mudam: `open`, `onOpenChange`, `batches`, `count`, `submitting?`).

- [ ] **Step 1: Update and add tests**

Em `apps/web/test/send-to-batch-dialog.test.tsx`:

(a) Nos dois testes que assertam `onConfirm` (posição `start` e `shuffle`), troque `batchId: 'b1',` por `batchIds: ['b1'],`.

(b) Acrescente, dentro do `describe('SendToBatchDialog', ...)`:

```tsx
  it('permite marcar vários lotes e mostra todos no resumo', () => {
    const onConfirm = vi.fn();
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={2}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Rodando/i));
    fireEvent.click(screen.getByLabelText(/Lote Concluído/i));
    expect(screen.getByLabelText(/Lote Rodando/i)).toBeChecked();
    expect(screen.getByLabelText(/Lote Concluído/i)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    expect(
      screen.getByText(/Enviar 2 produto\(s\) para «Lote Rodando», «Lote Concluído»/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/será reativado e voltará a rodar/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirmar|enviar/i }));
    expect(onConfirm).toHaveBeenCalledWith({ batchIds: ['b1', 'b2'], position: 'end' });
  });

  it('desmarcar o único lote volta a desabilitar o Avançar', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={1}
        onConfirm={vi.fn()}
      />,
    );
    const box = screen.getByLabelText(/Lote Rodando/i);
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: /avançar|continuar/i })).toBeEnabled();
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: /avançar|continuar/i })).toBeDisabled();
  });

  it('não lista os lotes de excludeBatchIds', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        excludeBatchIds={['b1']}
        count={1}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText('Lote Rodando')).not.toBeInTheDocument();
    expect(screen.getByText('Lote Concluído')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/send-to-batch-dialog.test.tsx`
Expected: FAIL (hoje é radio; `onConfirm` recebe `batchId`; `excludeBatchIds` não existe).

- [ ] **Step 3: Write the implementation**

Substitua o conteúdo de `apps/web/src/components/queue/send-to-batch-dialog.tsx` por:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { eligibleBatches } from '@/lib/batch-target';
import type { BatchPosition, BatchSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const BATCH_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Agendado',
  RUNNING: 'Enviando',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
  CANCELLED: 'Cancelado',
};

const POSITIONS: Array<{ value: BatchPosition; label: string; title: string; hint: string }> = [
  {
    value: 'end',
    label: 'Fim da fila',
    title: 'Fim da fila (padrão)',
    hint: 'Os produtos entram após todos os envios pendentes existentes.',
  },
  {
    value: 'start',
    label: 'Começo da fila',
    title: 'Começo da fila',
    hint: 'Os produtos entram como os próximos a serem enviados pelo lote.',
  },
  {
    value: 'shuffle',
    label: 'Embaralhar',
    title: 'Embaralhar',
    hint: 'Os novos produtos entram em posições aleatórias entre os pendentes.',
  },
];

export interface SendToBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: BatchSummary[];
  count: number;
  /** Lotes que não devem aparecer como destino (ex.: o lote de origem). */
  excludeBatchIds?: string[];
  onConfirm: (params: { batchIds: string[]; position: BatchPosition }) => void | Promise<void>;
  submitting?: boolean;
}

export function SendToBatchDialog({
  open,
  onOpenChange,
  batches,
  count,
  excludeBatchIds = [],
  onConfirm,
  submitting = false,
}: SendToBatchDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState<BatchPosition>('end');

  const availableBatches = eligibleBatches(batches).filter((b) => !excludeBatchIds.includes(b.id));
  const selectedBatches = availableBatches.filter((b) => selectedIds.has(b.id));
  const doneBatches = selectedBatches.filter((b) => b.status === 'DONE');

  useEffect(() => {
    if (open) {
      setStep(1);
      setPosition('end');
      setSelectedIds(new Set());
    }
  }, [open]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = () => {
    if (selectedBatches.length === 0) return;
    onConfirm({ batchIds: selectedBatches.map((b) => b.id), position });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand" />
            {step === 1 ? 'Enviar produtos para lotes' : 'Confirmar posição nos lotes'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Marque um ou mais lotes de destino para os produtos selecionados.'
              : 'Defina onde os novos produtos serão inseridos na fila de cada lote.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            {availableBatches.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-2 p-4 text-center text-sm text-muted-foreground">
                Nenhum lote disponível — crie um lote antes de enviar produtos.
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {availableBatches.map((b) => {
                  const isSelected = selectedIds.has(b.id);
                  return (
                    <label
                      key={b.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm transition-colors',
                        isSelected
                          ? 'border-brand bg-brand/5 ring-1 ring-brand'
                          : 'border-border bg-surface hover:bg-surface-2',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          value={b.id}
                          checked={isSelected}
                          onChange={() => toggle(b.id)}
                          aria-label={b.name}
                          className="text-brand focus:ring-brand"
                        />
                        <div>
                          <div className="font-medium text-foreground">{b.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {b.pending} pendente(s) · {b.total} total
                          </div>
                        </div>
                      </div>
                      <StatusPill
                        label={BATCH_STATUS_LABEL[b.status] ?? b.status}
                        status={b.status}
                      />
                    </label>
                  );
                })}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={selectedBatches.length === 0}
                onClick={() => setStep(2)}
              >
                Avançar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && selectedBatches.length > 0 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm font-medium">
              {`Enviar ${count} produto(s) para ${selectedBatches.map((b) => `«${b.name}»`).join(', ')}`}
            </div>

            {doneBatches.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                {doneBatches.length === 1 ? (
                  <div>
                    O lote «{doneBatches[0]!.name}» está concluído e{' '}
                    <strong>será reativado e voltará a rodar</strong> no próximo horário válido da
                    janela de envio.
                  </div>
                ) : (
                  <div>
                    Os lotes concluídos {doneBatches.map((b) => `«${b.name}»`).join(', ')}{' '}
                    <strong>serão reativados e voltarão a rodar</strong> no próximo horário válido da
                    janela de envio.
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Posição na fila
              </span>
              <div className="space-y-2">
                {POSITIONS.map((p) => (
                  <label
                    key={p.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                      position === p.value
                        ? 'border-brand bg-brand/5 ring-1 ring-brand'
                        : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="radio"
                      name="batch-position"
                      value={p.value}
                      checked={position === p.value}
                      onChange={() => setPosition(p.value)}
                      aria-label={p.label}
                      className="mt-0.5 text-brand focus:ring-brand"
                    />
                    <div>
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Voltar
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Enviando...' : 'Confirmar'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/web exec vitest run test/send-to-batch-dialog.test.tsx`
Expected: PASS em todos os testes do arquivo (os antigos e os 3 novos). Se o teste "mostra aviso de reativação" falhar, confira que o `<strong>` contém exatamente `será reativado e voltará a rodar`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/queue/send-to-batch-dialog.tsx apps/web/test/send-to-batch-dialog.test.tsx
git commit -m "feat(web): dialog de envio para lote aceita vários lotes destino

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hook `useShareToBatches` e integração na triagem

**Files:**
- Create: `apps/web/src/lib/use-share-to-batches.ts`
- Modify: `apps/web/src/app/(app)/enviar/page.tsx`
- Test: `apps/web/test/enviar-page.test.tsx`

**Interfaces:**
- Consumes: `summarizeShare`, `BatchShareResponse` (Task 3); `SendToBatchDialog` com `onConfirm({ batchIds, position })` (Task 4); `useApiMutation` (`@/lib/mutations`).
- Produces: `useShareToBatches(batches: BatchSummary[], onShared: () => void)` → mutation cujo `mutate` recebe `{ productIds: string[]; batchIds: string[]; position: BatchPosition }`. `onShared` roda quando ao menos um lote deu certo. Toast de sucesso: `"{added} adicionado(s) em {okCount} lote(s)"` + `" ({skipped} ignorado(s))"` se `skipped > 0`; para cada falha, `toast.error("«{nome}»: {mensagem}")`.

- [ ] **Step 1: Update the page tests**

Em `apps/web/test/enviar-page.test.tsx`:

(a) Primeiro teste ("abre o modal ao clicar..."):
- Troque a condição do mock `path === '/batches/batch-123/send-products'` por `path === '/batches/share'`, e o retorno por:
```ts
        return {
          results: [
            { batchId: 'batch-123', ok: true, added: 2, skipped: 0, reactivated: false, status: 'RUNNING', error: null },
          ],
        };
```
- No `toHaveBeenCalledWith`, troque por:
```ts
      expect(apiFetchMock).toHaveBeenCalledWith('/batches/share', {
        method: 'POST',
        json: {
          productIds: ['p1', 'p2'],
          batchIds: ['batch-123'],
          position: 'start',
        },
      });
```
- Troque o toast esperado por `'2 adicionado(s) em 1 lote(s)'`.
- A linha `const batchRadio = screen.getByLabelText('Lote Principal');` continua válida (agora é checkbox).

(b) Segundo teste ("mostra mensagem com ignorados..."): mesmo ajuste de mock (`'/batches/share'`, retorno `{ results: [{ batchId: 'batch-123', ok: true, added: 1, skipped: 1, reactivated: false, status: 'RUNNING', error: null }] }`), `toHaveBeenCalledWith('/batches/share', { method: 'POST', json: { productIds: ['p1', 'p2'], batchIds: ['batch-123'], position: 'end' } })` e toast `'1 adicionado(s) em 1 lote(s) (1 ignorado(s))'`.

(c) Novo teste (dois lotes, um falha), dentro do `describe`:

```tsx
  it('envia para dois lotes e mostra erro do lote que falhou', async () => {
    apiFetchMock.mockImplementation(async (path: string, options?: any) => {
      if (path === '/queue') return mockQueue;
      if (path === '/batches') return mockBatches;
      if (path === '/sessions') return mockSessions;
      if (path.startsWith('/templates')) return mockTemplates;
      if (path === '/settings') return mockSettings;
      if (path.startsWith('/groups')) return [];
      if (path.startsWith('/telegram/chats')) return [];
      if (path === '/batches/share' && options?.method === 'POST') {
        return {
          results: [
            { batchId: 'batch-123', ok: true, added: 2, skipped: 0, reactivated: false, status: 'RUNNING', error: null },
            { batchId: 'batch-done', ok: false, added: 0, skipped: 0, reactivated: false, status: null, error: { code: 'BATCH_INACTIVE', message: 'Lote cancelado não pode receber produtos' } },
          ],
        };
      }
      return [];
    });

    renderEnviarPage();
    expect(await screen.findByText('Fone Bluetooth')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /trazer selecionados para lote/i }));
    fireEvent.click(await screen.findByLabelText('Lote Principal'));
    fireEvent.click(screen.getByLabelText('Lote Antigo'));
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/batches/share', {
        method: 'POST',
        json: { productIds: ['p1', 'p2'], batchIds: ['batch-123', 'batch-done'], position: 'end' },
      });
      expect(toast.success).toHaveBeenCalledWith('2 adicionado(s) em 1 lote(s)');
      expect(toast.error).toHaveBeenCalledWith('«Lote Antigo»: Lote cancelado não pode receber produtos');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/enviar-page.test.tsx`
Expected: FAIL (a página ainda chama `/batches/:id/send-products`).

- [ ] **Step 3: Write the implementation**

3a. Crie `apps/web/src/lib/use-share-to-batches.ts`:

```ts
'use client';
import { toast } from 'sonner';
import { apiFetch } from './api';
import { summarizeShare } from './batch-target';
import { useApiMutation } from './mutations';
import type { BatchPosition, BatchShareResponse, BatchSummary } from './types';

const INV = [['queue'], ['batches'], ['overview']];

export interface ShareToBatchesInput {
  productIds: string[];
  batchIds: string[];
  position: BatchPosition;
}

/**
 * Copia produtos para um ou mais lotes (POST /batches/share) e mostra o resumo em toasts.
 * `onShared` roda quando ao menos um lote recebeu os produtos.
 */
export function useShareToBatches(batches: BatchSummary[], onShared: () => void) {
  return useApiMutation(
    (body: ShareToBatchesInput) =>
      apiFetch<BatchShareResponse>('/batches/share', { method: 'POST', json: body }),
    {
      invalidate: INV,
      onSuccess: (out) => {
        const s = summarizeShare(out.results, batches);
        if (s.okCount > 0) {
          const skipped = s.skipped > 0 ? ` (${s.skipped} ignorado(s))` : '';
          toast.success(`${s.added} adicionado(s) em ${s.okCount} lote(s)${skipped}`);
          onShared();
        }
        for (const f of s.failed) toast.error(`«${f.name}»: ${f.message}`);
      },
    },
  );
}
```

3b. `apps/web/src/app/(app)/enviar/page.tsx`:
- Remova `import { toast } from 'sonner';` e a linha `import type { BatchPosition, BatchSendProductsResponse } from '@/lib/types';`.
- Adicione `import { useShareToBatches } from '@/lib/use-share-to-batches';`.
- Substitua o bloco `const sendToBatch = useApiMutation(...)` (da linha `const sendToBatch = useApiMutation(` até o `);` que o fecha) por:

```tsx
  const sendToBatch = useShareToBatches(batches ?? [], () => setSendToBatchOpen(false));
```
- No `<SendToBatchDialog ... />`, troque o `onConfirm` por:

```tsx
        onConfirm={({ batchIds, position }) =>
          sendToBatch.mutate({ productIds: selectedPendingProductIds, batchIds, position })
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/web exec vitest run test/enviar-page.test.tsx test/queue-table-send-to-batch.test.tsx`
Expected: PASS. Depois: `pnpm --filter @afilados/web typecheck` limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-share-to-batches.ts "apps/web/src/app/(app)/enviar/page.tsx" apps/web/test/enviar-page.test.tsx
git commit -m "feat(web): triagem envia para vários lotes via /batches/share

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Compartilhar de dentro do drawer do lote

**Files:**
- Modify: `apps/web/src/components/queue/batch-manage-drawer.tsx`
- Test: `apps/web/test/batch-manage-drawer.test.tsx`

**Interfaces:**
- Consumes: `useShareToBatches` (Task 5), `SendToBatchDialog` com `excludeBatchIds` (Task 4), `useBatches` de `@/lib/queries`.
- Produces: checkbox (`aria-label="Selecionar {título}"`) em cada item de produto do lote e botão `"Compartilhar selecionados (N)"`, ambos em qualquer status do lote.

- [ ] **Step 1: Write the failing tests**

Em `apps/web/test/batch-manage-drawer.test.tsx`, acrescente `waitFor` ao import de `@testing-library/react` e, dentro do `describe('BatchManageDrawer', ...)` (ao lado do `describe('lote pausado', ...)`), adicione:

```tsx
  describe('compartilhar com outros lotes', () => {
    const productItem = (id: string, order: number, productId: string, title: string) => ({
      ...baseItem,
      id,
      order,
      status: 'PENDING',
      productId,
      product: { title, images: [] },
    });
    const running = {
      ...batch,
      status: 'RUNNING',
      items: [
        productItem('i1', 0, 'p1', 'Fone Bluetooth'),
        productItem('i2', 1, 'p2', 'Mouse Gamer'),
        { ...baseItem, id: 'i3', order: 2, status: 'PENDING', customText: 'Aviso' },
      ],
    };
    const summary = (id: string, name: string, status: string) => ({
      id,
      name,
      status,
      intervalMin: 5,
      mediaMode: 'IMAGE',
      shuffled: false,
      groupJids: [],
      telegramChatIds: [],
      estimatedEndAt: null,
      createdAt: '2026-10-12T10:00:00.000Z',
      total: 4,
      sent: 1,
      errors: 0,
    });

    function renderRunning() {
      apiFetchMock.mockImplementation(async (url: string, opts?: any) => {
        if (url === '/batches/b1') return running as never;
        if (url === '/batches') {
          return [
            summary('b1', 'Lote Origem', 'RUNNING'),
            summary('b2', 'Lote Destino', 'RUNNING'),
          ] as never;
        }
        if (url === '/batches/share' && opts?.method === 'POST') {
          return {
            results: [
              { batchId: 'b2', ok: true, added: 1, skipped: 0, reactivated: false, status: 'RUNNING', error: null },
            ],
          } as never;
        }
        return [] as never;
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <BatchManageDrawer batchId="b1" onClose={() => {}} />
        </QueryClientProvider>,
      );
    }

    it('lote rodando: checkbox só nos itens de produto e botão desabilitado sem seleção', async () => {
      renderRunning();
      expect(await screen.findByLabelText('Selecionar Fone Bluetooth')).toBeTruthy();
      expect(screen.getByLabelText('Selecionar Mouse Gamer')).toBeTruthy();
      expect(screen.getAllByRole('checkbox', { name: /^Selecionar / })).toHaveLength(2);
      expect(screen.getByRole('button', { name: /Compartilhar selecionados/ })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('compartilha os selecionados com outro lote sem pausar o de origem', async () => {
      renderRunning();
      fireEvent.click(await screen.findByLabelText('Selecionar Fone Bluetooth'));
      fireEvent.click(screen.getByRole('button', { name: 'Compartilhar selecionados (1)' }));

      // o lote de origem não aparece como destino
      expect(await screen.findByLabelText('Lote Destino')).toBeTruthy();
      expect(screen.queryByLabelText('Lote Origem')).toBeNull();

      fireEvent.click(screen.getByLabelText('Lote Destino'));
      fireEvent.click(screen.getByRole('button', { name: /avançar/i }));
      fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledWith('/batches/share', {
          method: 'POST',
          json: { productIds: ['p1'], batchIds: ['b2'], position: 'end' },
        });
      });
      expect(apiFetchMock).not.toHaveBeenCalledWith('/batches/b1/pause', expect.anything());
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/batch-manage-drawer.test.tsx`
Expected: FAIL (não existem checkboxes nem botão de compartilhar).

- [ ] **Step 3: Write the implementation**

Em `apps/web/src/components/queue/batch-manage-drawer.tsx`:

3a. Imports: trocar `import { useMemo, useState } from 'react';` por `import { useEffect, useMemo, useState } from 'react';`; no import do lucide incluir `Share2` (ficando `ArrowDown, ArrowUp, ChevronsUp, GripVertical, RotateCw, Share2, Trash2`); adicionar:

```tsx
import { SendToBatchDialog } from '@/components/queue/send-to-batch-dialog';
import { useShareToBatches } from '@/lib/use-share-to-batches';
```
e incluir `useBatches` no import de `@/lib/queries`:
`import { useBatch, useBatches, useGroups, useQueue, useTelegramAllChats, useTemplates } from '@/lib/queries';`

3b. Em `BatchManageDrawer`, logo depois de `const canPause = ...;`, adicionar o estado de compartilhamento:

```tsx
  const { data: allBatches } = useBatches();
  const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    setShareSelected(new Set());
    setShareOpen(false);
  }, [batchId]);
  // só vale o que ainda existe no lote
  const shareIds = useMemo(() => {
    const inBatch = new Set((batch?.items ?? []).map((i) => i.productId).filter(Boolean));
    return [...shareSelected].filter((id) => inBatch.has(id));
  }, [batch?.items, shareSelected]);
  const toggleShare = (productId: string) =>
    setShareSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  const share = useShareToBatches(allBatches ?? [], () => {
    setShareOpen(false);
    setShareSelected(new Set());
  });
```
(O estado fica no `BatchManageDrawer` porque o `ItemsSection` é remontado pela `key` sempre que a assinatura dos itens muda; assim a seleção sobrevive ao lote avançar.)

3c. Envolver o retorno em fragmento e renderizar o dialog fora do `<Drawer>`: troque `return (\n    <Drawer ...` por `return (\n    <>\n    <Drawer ...` e, depois do `</Drawer>`, antes de `);`, adicione:

```tsx
    <SendToBatchDialog
      open={shareOpen}
      onOpenChange={setShareOpen}
      batches={allBatches ?? []}
      excludeBatchIds={batchId ? [batchId] : []}
      count={shareIds.length}
      submitting={share.isPending}
      onConfirm={({ batchIds, position }) =>
        share.mutate({ productIds: shareIds, batchIds, position })
      }
    />
    </>
```
Ajuste a indentação do bloco do `<Drawer>` para o novo nível (ou rode o formatador do projeto).

3d. Passar as props novas ao `ItemsSection` (no JSX do `BatchManageDrawer`):

```tsx
            <ItemsSection
              key={`items-${itemsSignature(batch)}`}
              batch={batch}
              editable={editable}
              shareIds={shareIds}
              onToggleShare={toggleShare}
              onShare={() => setShareOpen(true)}
            />
```

3e. Descrições: em `DrawerDescription`, trocar o ramo `canPause` por `'Para editar, pause o lote. Envios agendados ficam suspensos até você retomar. Para compartilhar ofertas com outros lotes não precisa pausar.'` e o ramo final por `'Lote finalizado: edição indisponível (você ainda pode compartilhar ofertas com outros lotes).'`.

3f. `ItemsSection`: a assinatura passa a ser

```tsx
function ItemsSection({
  batch,
  editable,
  shareIds,
  onToggleShare,
  onShare,
}: {
  batch: BatchDetail;
  editable: boolean;
  shareIds: string[];
  onToggleShare: (productId: string) => void;
  onShare: () => void;
}) {
```
No cabeçalho da seção (o `<div className="flex items-center gap-2">` com o `<h3>`), logo após o `<h3>`, adicionar:

```tsx
        <Button
          size="sm"
          variant="secondary"
          disabled={shareIds.length === 0}
          onClick={onShare}
        >
          <Share2 className="size-3.5" />
          Compartilhar selecionados ({shareIds.length})
        </Button>
```
(o botão "Salvar ordem" tem `ml-auto` e continua à direita.)

Defina, dentro de `ItemsSection`, antes do `return`:

```tsx
  const shareProps = (it: BatchItem) =>
    it.productId && it.product
      ? {
          checked: shareIds.includes(it.productId),
          onChange: () => onToggleShare(it.productId!),
          label: `Selecionar ${it.product.title}`,
        }
      : undefined;
```
e nos dois usos de `<ItemRow ...>` (lista `done` e lista `pending`) adicionar a prop `select={shareProps(it)}`.

3g. `ItemRow`: adicionar a prop `select?: { checked: boolean; onChange: () => void; label: string }` à desestruturação e ao tipo, e renderizar logo antes do `<span className="w-6 ...">{position}</span>`:

```tsx
      {select && (
        <NativeCheckbox
          checked={select.checked}
          onChange={select.onChange}
          aria-label={select.label}
        />
      )}
```
(`NativeCheckbox` já está importado no arquivo.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/web exec vitest run test/batch-manage-drawer.test.tsx`
Expected: PASS (os testes antigos do drawer continuam passando; se algum quebrar por causa do texto da descrição, ajuste o teste para o texto novo).

- [ ] **Step 5: Full web verification and commit**

Run:
```bash
pnpm --filter @afilados/web exec vitest run
pnpm --filter @afilados/web typecheck
```
Expected: suíte inteira PASS e typecheck limpo.

```bash
git add apps/web/src/components/queue/batch-manage-drawer.tsx apps/web/test/batch-manage-drawer.test.tsx
git commit -m "feat(web): compartilhar ofertas com outros lotes direto do drawer, sem pausar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Validação completa e Docker (obrigatório antes de concluir)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Typecheck e testes de tudo**

```bash
pnpm typecheck
.superpowers/sdd/remote.sh run pnpm test
```
Expected: typecheck limpo; suíte completa PASS (api no servidor Linux; web e shared também passam lá).

- [ ] **Step 2: Subir no Docker**

```bash
docker compose up -d --build --wait
```
Expected: api (3011), worker (3012) e web (3010) saudáveis.

- [ ] **Step 3: Validar o fluxo real no navegador (web em :3010)**

1. Triagem: salvar 3 produtos, selecionar, **Trazer selecionados para lote**, marcar **2 lotes** (um rodando e um concluído), posição "Começo da fila", confirmar. Esperado: toast "3 adicionado(s) em 2 lote(s)"; os produtos somem da triagem; o lote concluído é reativado; no drawer de cada lote a ordem está correta.
2. Drawer: abrir **Gerenciar** num lote **rodando** (sem pausar), marcar 1–2 produtos, **Compartilhar selecionados**, escolher outro lote, confirmar. Esperado: o lote de origem **não** aparece como destino; a origem continua com os itens e segue rodando (nunca pausou); o destino recebe e agenda. O modal abre normalmente por cima do drawer (conferir foco e teclado — dialog dentro de drawer é o ponto de maior risco visual).
3. Repetir o mesmo produto para o mesmo destino: toast com "(N ignorado(s))", sem erro.
4. Lote cancelado + lote rodando juntos (cancelar um lote antes): toast de sucesso do rodando e toast de erro nomeando o cancelado.
5. `docker compose logs worker | grep send-offer`: conferir que os itens novos são enviados no horário agendado. O smoke de envio real no WhatsApp depende de sessão conectada do usuário — reportar se não puder ser feito.

- [ ] **Step 4: Fechar a branch**

Só depois de tudo acima, invocar `superpowers:finishing-a-development-branch` para decidir merge/PR da branch `feat/compartilhar-ofertas-lotes`.
