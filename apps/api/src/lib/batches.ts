import type { Batch, BatchItem, TenantClient } from '@afilados/db';
import { scheduleBatch, type OperatingWindow } from '@afilados/core';
import { ApiError, QUEUE_SEND_OFFER, type ProductData, type SendOfferJob } from '@afilados/shared';
import { getQueue } from './redis';

export const SAMPLE_PRODUCT: ProductData = {
  source: 'SHOPEE',
  externalId: 'exemplo',
  title: 'Fone Bluetooth XYZ',
  price: 129.9,
  originalPrice: 199.9,
  discountPct: 35,
  salesCount: 1250,
  commissionPct: 5,
  images: ['https://cf.shopee.com.br/file/exemplo'],
  shipping: 'FREE',
  couponCode: 'AFILIADO10',
  originalUrl: 'https://shopee.com.br/product/1/1',
  raw: {},
};

export async function enqueueBatchItems(
  items: { id: string; runAt: Date }[],
  tenantId: string,
  now = new Date(),
) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await q.addBulk(
    items.map((it) => ({
      name: 'send-offer',
      data: { tenantId, batchItemId: it.id },
      opts: {
        jobId: it.id,
        delay: Math.max(0, it.runAt.getTime() - now.getTime()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })),
  );
}

export interface InsertBatchItemResult {
  id: string;
  /** null quando o lote está pausado: o horário só é definido no "Retomar". */
  runAt: Date | null;
  total: number;
  estimatedEndAt: Date | null;
}

/**
 * Coloca um produto como o PRÓXIMO envio de um lote ativo: o item ocupa o primeiro lugar da
 * fila e os pendentes andam um intervalo para frente. Em lote pausado só reordena (o "Retomar"
 * agenda tudo). `batch.items` precisa vir ordenado por `order`.
 */
export async function insertBatchItemNext(args: {
  db: TenantClient;
  tenantId: string;
  batch: Batch & { items: BatchItem[] };
  productId: string;
  window: OperatingWindow;
  now?: Date;
}): Promise<InsertBatchItemResult> {
  const { db, tenantId, batch, productId, window, now = new Date() } = args;

  if (batch.status === 'DONE' || batch.status === 'CANCELLED') {
    throw new ApiError('BATCH_INACTIVE', 'Lote não está ativo', 409);
  }
  if (
    batch.items.some(
      (i) => i.productId === productId && (i.status === 'PENDING' || i.status === 'SENDING'),
    )
  ) {
    throw new ApiError('BATCH_DUPLICATE', 'Produto já está neste lote', 409);
  }

  const pending = batch.items.filter((i) => i.status === 'PENDING');
  const others = batch.items.filter((i) => i.status !== 'PENDING');
  const base = Math.max(-1, ...others.map((i) => i.order)) + 1;

  const reorderPending = pending.map((it, idx) =>
    db.batchItem.updateMany({ where: { id: it.id }, data: { order: base + 1 + idx } }),
  );

  if (batch.status === 'PAUSED') {
    const [created] = await db.$transaction([
      db.batchItem.create({ data: { batchId: batch.id, productId, order: base, runAt: now } }),
      ...reorderPending,
    ]);
    return {
      id: created.id,
      runAt: null,
      total: batch.items.length + 1,
      estimatedEndAt: batch.estimatedEndAt,
    };
  }

  // Ponto de partida: o horário do primeiro pendente (ou agora, se já venceu). Sem pendentes,
  // um intervalo depois do último envio.
  let startAt = now;
  if (pending.length > 0) {
    const firstRun = pending[0]!.runAt;
    startAt = firstRun > now ? firstRun : now;
  } else {
    const lastRun = Math.max(
      0,
      ...others
        .filter((i) => i.status === 'SENT' || i.status === 'SENDING')
        .map((i) => i.runAt.getTime()),
    );
    if (lastRun > 0)
      startAt = new Date(Math.max(now.getTime(), lastRun + batch.intervalMin * 60_000));
  }
  const { runAt, estimatedEndAt } = scheduleBatch(
    pending.length + 1,
    batch.intervalMin,
    window,
    startAt,
  );

  // Tira os jobs antigos (qualquer estado, menos "active") para o mesmo jobId poder ser reenfileirado.
  await removeStaleJobs(pending.map((i) => i.id));

  const runAtFor = (idx: number) => runAt[idx]!;
  const [created] = await db.$transaction([
    db.batchItem.create({
      data: { batchId: batch.id, productId, order: base, runAt: runAtFor(0) },
    }),
    ...pending.map((it, idx) =>
      db.batchItem.updateMany({
        where: { id: it.id },
        data: { order: base + 1 + idx, runAt: runAtFor(idx + 1) },
      }),
    ),
    db.batch.updateMany({ where: { id: batch.id }, data: { estimatedEndAt } }),
  ]);

  try {
    await enqueueBatchItems(
      [
        { id: created.id, runAt: runAtFor(0) },
        ...pending.map((it, idx) => ({ id: it.id, runAt: runAtFor(idx + 1) })),
      ],
      tenantId,
      now,
    );
  } catch {
    // Sem jobs, o lote ficaria parado sem aviso: pausa para o usuário retomar pelo painel.
    await db.batch.updateMany({ where: { id: batch.id }, data: { status: 'PAUSED' } });
    throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
  }

  return { id: created.id, runAt: runAtFor(0), total: batch.items.length + 1, estimatedEndAt };
}

/** Remove jobs antigos (inclusive falhos/concluídos) para o mesmo jobId poder ser reenfileirado. */
export async function removeStaleJobs(itemIds: string[]) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await Promise.all(
    itemIds.map(async (id) => {
      const job = await q.getJob(id);
      if (!job) return;
      const state = await job.getState();
      if (state !== 'active') await job.remove();
    }),
  );
}

export async function removePendingJobs(itemIds: string[]) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await Promise.all(
    itemIds.map(async (id) => {
      const job = await q.getJob(id);
      if (!job) return;
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') await job.remove();
    }),
  );
}
