import type { Batch, BatchItem, TenantClient } from '@afilados/db';
import { planBatchOrder, scheduleBatch, type CouponData, type OperatingWindow } from '@afilados/core';
import {
  ApiError,
  QUEUE_SEND_OFFER,
  type BatchPosition,
  type BatchStatus,
  type ProductData,
  type SendOfferJob,
} from '@afilados/shared';
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

export const SAMPLE_COUPON: CouponData = {
  store: 'SHOPEE',
  code: 'AFILIADO10',
  description: '10% de desconto em compras acima de R$ 50',
  expiresAt: null,
};

/** Select padrão para não carregar customImageData (BYTEA) nas queries comuns de lotes. */
export const batchItemPublicSelect = {
  id: true,
  batchId: true,
  productId: true,
  couponId: true,
  customText: true,
  customImageUrl: true,
  customImageType: true,
  order: true,
  runAt: true,
  status: true,
  error: true,
} as const;

export function toApiBatchItem<T extends { customImageType?: string | null; customImageData?: unknown }>(
  item: T,
) {
  const { customImageData: _unused, customImageType, ...rest } = item;
  return {
    ...rest,
    customImageType: customImageType ?? null,
    hasUploadedImage: Boolean(customImageType),
  };
}

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

export interface AddProductsToBatchArgs {
  db: TenantClient;
  tenantId: string;
  batch: Batch & {
    items: Array<Pick<BatchItem, 'id' | 'productId' | 'status' | 'order' | 'runAt'>>;
  };
  productIds: string[];
  position?: BatchPosition | undefined;
  /** Posição específica entre os pendentes (0 = primeiro pendente). Quando informado, ignora position. */
  index?: number | undefined;
  window: OperatingWindow;
  now?: Date | undefined;
  rng?: (() => number) | undefined;
}

export interface AddProductsToBatchResult {
  createdIds: string[];
  added: number;
  skipped: number;
  status: BatchStatus;
  estimatedEndAt: Date | null;
  reactivated: boolean;
  runAt: Date | null;
}

/**
 * Adiciona múltiplos produtos a um lote existente (rodando, agendado, pausado ou concluído).
 * - Pula produtos já presentes no lote (em qualquer status).
 * - 'shuffle': novos são embaralhados e inseridos entre os pendentes preservando a ordem destes.
 * - 'start': novos entram no início da fila de pendentes.
 * - 'end': novos entram no fim da fila de pendentes.
 * - Lote DONE é reativado para SCHEDULED e re-enfileirado no próximo horário válido.
 */
export async function addProductsToBatch(
  args: AddProductsToBatchArgs,
): Promise<AddProductsToBatchResult> {
  const {
    db,
    tenantId,
    batch,
    productIds,
    position = 'end',
    index,
    window,
    now = new Date(),
    rng,
  } = args;

  if (batch.status === 'CANCELLED') {
    throw new ApiError('BATCH_INACTIVE', 'Lote cancelado não pode receber produtos', 409);
  }

  const existingProductIds = new Set(
    batch.items.map((i) => i.productId).filter((p): p is string => Boolean(p)),
  );
  const uniqueIncoming = [...new Set(productIds)];
  const toAdd = uniqueIncoming.filter((id) => !existingProductIds.has(id));
  const skipped = productIds.length - toAdd.length;

  if (toAdd.length === 0) {
    return {
      createdIds: [],
      added: 0,
      skipped,
      status: batch.status,
      estimatedEndAt: batch.estimatedEndAt,
      reactivated: false,
      runAt: null,
    };
  }

  const pending = batch.items.filter((i) => i.status === 'PENDING');
  const others = batch.items.filter((i) => i.status !== 'PENDING');
  const base = Math.max(-1, ...others.map((i) => i.order)) + 1;

  type PlannedItem =
    | { kind: 'new'; productId: string }
    | { kind: 'existing'; item: (typeof pending)[number] };

  const pendingEntries: PlannedItem[] = pending.map((item) => ({ kind: 'existing', item }));
  const incomingEntries: PlannedItem[] = toAdd.map((productId) => ({ kind: 'new', productId }));

  let ordered: PlannedItem[];
  if (index !== undefined) {
    const pos = Math.min(Math.max(Math.trunc(index), 0), pendingEntries.length);
    ordered = [
      ...pendingEntries.slice(0, pos),
      ...incomingEntries,
      ...pendingEntries.slice(pos),
    ];
  } else {
    ordered = planBatchOrder(
      pendingEntries,
      incomingEntries,
      position,
      (x) => (x.kind === 'existing' ? x.item.productId ?? '' : x.productId),
      rng,
    );
  }

  if (batch.status === 'PAUSED') {
    const created: BatchItem[] = [];
    await db.$transaction(async (tx) => {
      for (let idx = 0; idx < ordered.length; idx++) {
        const entry = ordered[idx]!;
        if (entry.kind === 'new') {
          const item = await tx.batchItem.create({
            data: { batchId: batch.id, productId: entry.productId, order: base + idx, runAt: now },
          });
          created.push(item);
        } else {
          await tx.batchItem.updateMany({
            where: { id: entry.item.id },
            data: { order: base + idx },
          });
        }
      }
    });

    return {
      createdIds: created.map((i) => i.id),
      added: toAdd.length,
      skipped,
      status: 'PAUSED',
      estimatedEndAt: batch.estimatedEndAt,
      reactivated: false,
      runAt: null,
    };
  }

  // Lotes SCHEDULED, RUNNING ou DONE
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
    if (lastRun > 0) {
      startAt = new Date(Math.max(now.getTime(), lastRun + batch.intervalMin * 60_000));
    }
  }

  const { runAt, estimatedEndAt } = scheduleBatch(
    ordered.length,
    batch.intervalMin,
    window,
    startAt,
  );

  await removeStaleJobs(pending.map((i) => i.id));

  const runAtFor = (idx: number) => runAt[idx]!;
  const created: BatchItem[] = [];
  const allItemsToEnqueue: Array<{ id: string; runAt: Date }> = [];

  await db.$transaction(async (tx) => {
    for (let idx = 0; idx < ordered.length; idx++) {
      const entry = ordered[idx]!;
      const itemRunAt = runAtFor(idx);
      if (entry.kind === 'new') {
        const item = await tx.batchItem.create({
          data: {
            batchId: batch.id,
            productId: entry.productId,
            order: base + idx,
            runAt: itemRunAt,
          },
        });
        created.push(item);
        allItemsToEnqueue.push({ id: item.id, runAt: itemRunAt });
      } else {
        await tx.batchItem.updateMany({
          where: { id: entry.item.id },
          data: { order: base + idx, runAt: itemRunAt },
        });
        allItemsToEnqueue.push({ id: entry.item.id, runAt: itemRunAt });
      }
    }
    await tx.batch.updateMany({ where: { id: batch.id }, data: { estimatedEndAt } });
  });

  let reactivated = false;
  if (batch.status === 'DONE') {
    const updated = await db.batch.updateMany({
      where: { id: batch.id, status: 'DONE' },
      data: { status: 'SCHEDULED' },
    });
    reactivated = updated.count > 0;
  }

  const finalStatus: BatchStatus =
    reactivated || batch.status === 'DONE' ? 'SCHEDULED' : batch.status;

  try {
    await enqueueBatchItems(allItemsToEnqueue, tenantId, now);
  } catch {
    await db.batch.updateMany({ where: { id: batch.id }, data: { status: 'PAUSED' } });
    throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
  }

  const firstNewRunAt = created.length > 0 ? created[0]!.runAt : null;

  return {
    createdIds: created.map((i) => i.id),
    added: toAdd.length,
    skipped,
    status: finalStatus,
    estimatedEndAt,
    reactivated,
    runAt: firstNewRunAt,
  };
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
  batch: Batch & {
    items: Array<Pick<BatchItem, 'id' | 'productId' | 'status' | 'order' | 'runAt'>>;
  };
  productId: string;
  window: OperatingWindow;
  now?: Date | undefined;
  /** Posição entre os pendentes (0 = próximo envio, padrão). Valores fora da faixa são ajustados. */
  index?: number | undefined;
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

  const res = await addProductsToBatch({
    db,
    tenantId,
    batch,
    productIds: [productId],
    position: 'start',
    index: args.index,
    window,
    now,
  });

  return {
    id: res.createdIds[0]!,
    runAt: res.runAt,
    total: batch.items.length + res.added,
    estimatedEndAt: res.estimatedEndAt,
  };
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
