import { prisma } from '@afilados/db';
import { scheduleBatch } from '@afilados/core';
import { enqueueSendOffer } from '../lib/queue-helpers';

export interface AddItemToBatchArgs {
  tenantId: string;
  batchId: string;
  customText?: string | undefined;
  productId?: string | undefined;
  couponCode?: string | undefined;
  imageBuffer?: Buffer | undefined;
  imageMime?: string | undefined;
  now?: Date | undefined;
}

export interface AddItemToBatchResult {
  success: boolean;
  batchName: string;
  runAt: Date | null;
  batchStatus: string;
  error?: string | undefined;
}

export async function addItemToBatch(args: AddItemToBatchArgs): Promise<AddItemToBatchResult> {
  const { tenantId, batchId, customText, productId, imageBuffer, imageMime, now = new Date() } = args;

  if (!customText && !productId) {
    return {
      success: false,
      batchName: '',
      runAt: null,
      batchStatus: 'UNKNOWN',
      error: 'Nenhum texto ou produto informado para adicionar ao lote',
    };
  }

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, status: true, runAt: true },
      },
    },
  });

  if (!batch || batch.tenantId !== tenantId) {
    return {
      success: false,
      batchName: '',
      runAt: null,
      batchStatus: 'UNKNOWN',
      error: 'Lote não encontrado',
    };
  }

  if (batch.status === 'CANCELLED') {
    return {
      success: false,
      batchName: batch.name,
      runAt: null,
      batchStatus: batch.status,
      error: 'Lote cancelado não pode receber novas ofertas',
    };
  }

  const baseOrder = Math.max(-1, ...batch.items.map((i) => i.order)) + 1;

  if (batch.status === 'PAUSED') {
    await prisma.batchItem.create({
      data: {
        batchId: batch.id,
        ...(productId ? { productId } : {}),
        ...(customText ? { customText } : {}),
        ...(imageBuffer ? { customImageData: imageBuffer, customImageType: imageMime ?? 'image/jpeg' } : {}),
        order: baseOrder,
        runAt: now,
        status: 'PENDING',
      },
    });

    return {
      success: true,
      batchName: batch.name,
      runAt: null,
      batchStatus: 'PAUSED',
    };
  }

  // Para lotes SCHEDULED, RUNNING ou DONE:
  const windowRow = await prisma.operatingWindow.findUnique({ where: { tenantId } });
  const window = windowRow
    ? {
        startTime: windowRow.startTime,
        endTime: windowRow.endTime,
        timezone: windowRow.timezone,
        enabled: windowRow.enabled,
      }
    : { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };

  const pending = batch.items.filter((i) => i.status === 'PENDING');
  const others = batch.items.filter((i) => i.status !== 'PENDING');

  let startAt = now;
  if (pending.length > 0) {
    const lastPending = pending[pending.length - 1]!;
    startAt = new Date(Math.max(now.getTime(), lastPending.runAt.getTime() + batch.intervalMin * 60_000));
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

  const { runAt } = scheduleBatch(1, batch.intervalMin, window, startAt);
  const itemRunAt = runAt[0]!;

  const newItem = await prisma.batchItem.create({
    data: {
      batchId: batch.id,
      ...(productId ? { productId } : {}),
      ...(customText ? { customText } : {}),
      ...(imageBuffer ? { customImageData: imageBuffer, customImageType: imageMime ?? 'image/jpeg' } : {}),
      order: baseOrder,
      runAt: itemRunAt,
      status: 'PENDING',
    },
  });

  const finalStatus = batch.status === 'DONE' ? 'SCHEDULED' : batch.status;

  await prisma.batch.update({
    where: { id: batch.id },
    data: {
      status: finalStatus,
      ...(!batch.estimatedEndAt || batch.estimatedEndAt < itemRunAt
        ? { estimatedEndAt: itemRunAt }
        : {}),
    },
  });

  await enqueueSendOffer(tenantId, newItem.id);

  return {
    success: true,
    batchName: batch.name,
    runAt: itemRunAt,
    batchStatus: finalStatus,
  };
}
