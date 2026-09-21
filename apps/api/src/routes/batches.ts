import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { scheduleBatch, shuffleInterleaved } from '@afilados/core';
import { ApiError, batchCreateSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getOperatingWindow, toCoreWindow } from '../lib/settings';
import { enqueueBatchItems, removePendingJobs } from '../lib/batches';
import { toApiProduct } from '../lib/products';

const idParam = z.object({ id: z.string().min(1) });

async function findBatch(req: FastifyRequest) {
  const { id } = idParam.parse(req.params);
  const b = await req.db.batch.findFirst({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!b) throw ApiError.notFound('Lote não encontrado');
  return b;
}

export async function batchesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/batches', async (req, reply) => {
    const body = batchCreateSchema.parse(req.body);
    const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
    if (!session) throw ApiError.notFound('Sessão não encontrada');
    if (session.status !== 'CONNECTED')
      throw new ApiError('WA_NOT_CONNECTED', 'WhatsApp não está conectado', 400);
    const groups = await req.db.waGroup.findMany({
      where: { sessionId: session.id, jid: { in: body.groupJids } },
      select: { jid: true },
    });
    const known = new Set(groups.map((g) => g.jid));
    const unknown = body.groupJids.filter((j) => !known.has(j));
    if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
    if (body.telegramChatIds.length) {
      const chats = await req.db.telegramChat.findMany({
        where: { chatId: { in: body.telegramChatIds } },
        select: { chatId: true },
      });
      const knownChats = new Set(chats.map((c) => c.chatId));
      const unknownChats = body.telegramChatIds.filter((c) => !knownChats.has(c));
      if (unknownChats.length) {
        throw ApiError.validation(`Chats do Telegram desconhecidos: ${unknownChats.join(', ')}`);
      }
    }
    const template = await req.db.template.findFirst({ where: { id: body.templateId } });
    if (!template) throw ApiError.notFound('Template não encontrado');

    const queueItems = body.productIds
      ? await req.db.queueItem.findMany({
          where: { productId: { in: body.productIds } },
          include: { product: true },
        })
      : await req.db.queueItem.findMany({
          where: { selected: true, status: 'PENDING' },
          include: { product: true },
        });
    if (queueItems.length === 0) throw ApiError.validation('Nenhum produto selecionado na fila');

    const ordered = body.shuffled
      ? shuffleInterleaved(queueItems, (q) => q.product.source)
      : queueItems;
    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));
    const now = new Date();
    const { runAt, estimatedEndAt } = scheduleBatch(ordered.length, body.intervalMin, window, now);

    const batch = await req.db.batch.create({
      data: {
        tenantId: req.tenantId,
        sessionId: session.id,
        templateId: template.id,
        name: body.name,
        groupJids: body.groupJids,
        telegramChatIds: body.telegramChatIds,
        intervalMin: body.intervalMin,
        mediaMode: body.mediaMode,
        shuffled: body.shuffled,
        estimatedEndAt,
        items: {
          create: ordered.map((q, i) => ({ productId: q.productId, order: i, runAt: runAt[i]! })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    try {
      await enqueueBatchItems(batch.items, req.tenantId, now);
    } catch {
      await req.db.batch.updateMany({ where: { id: batch.id }, data: { status: 'CANCELLED' } });
      await req.db.batchItem.updateMany({
        where: { id: { in: batch.items.map((i) => i.id) } },
        data: { status: 'ERROR', error: 'falha ao enfileirar' },
      });
      throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
    }
    return reply.status(201).send({ batch: { ...batch, items: undefined }, items: batch.items });
  });

  app.get('/batches', async (req) => {
    const batches = await req.db.batch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: { select: { status: true } } },
    });
    return batches.map((b) => ({
      ...b,
      items: undefined,
      total: b.items.length,
      sent: b.items.filter((i) => i.status === 'SENT').length,
      errors: b.items.filter((i) => i.status === 'ERROR').length,
    }));
  });

  app.get('/batches/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = await req.db.batch.findFirst({
      where: { id },
      include: { items: { orderBy: { order: 'asc' }, include: { product: true } } },
    });
    if (!b) throw ApiError.notFound('Lote não encontrado');
    return {
      ...b,
      items: b.items.map((i) => ({ ...i, product: i.product ? toApiProduct(i.product) : null })),
    };
  });

  app.post('/batches/:id/pause', async (req) => {
    const b = await findBatch(req);
    if (b.status !== 'SCHEDULED' && b.status !== 'RUNNING')
      throw ApiError.validation(`Lote está ${b.status}`);
    await removePendingJobs(b.items.filter((i) => i.status === 'PENDING').map((i) => i.id));
    await req.db.batch.updateMany({ where: { id: b.id }, data: { status: 'PAUSED' } });
    return { status: 'PAUSED' };
  });

  app.post('/batches/:id/resume', async (req) => {
    const b = await findBatch(req);
    if (b.status !== 'PAUSED') throw ApiError.validation(`Lote está ${b.status}`);
    const pending = b.items.filter((i) => i.status === 'PENDING');
    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));
    const now = new Date();
    const { runAt, estimatedEndAt } = scheduleBatch(pending.length, b.intervalMin, window, now);
    await Promise.all(
      pending.map((it, i) =>
        req.db.batchItem.updateMany({ where: { id: it.id }, data: { runAt: runAt[i]! } }),
      ),
    );
    await req.db.batch.updateMany({
      where: { id: b.id },
      data: { status: 'SCHEDULED', estimatedEndAt },
    });
    try {
      await enqueueBatchItems(
        pending.map((it, i) => ({ id: it.id, runAt: runAt[i]! })),
        req.tenantId,
        now,
      );
    } catch {
      await req.db.batch.updateMany({ where: { id: b.id }, data: { status: 'PAUSED' } });
      throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
    }
    return { status: 'SCHEDULED', estimatedEndAt };
  });

  app.post('/batches/:id/cancel', async (req) => {
    const b = await findBatch(req);
    if (b.status === 'DONE' || b.status === 'CANCELLED')
      throw ApiError.validation(`Lote está ${b.status}`);
    const pending = b.items.filter((i) => i.status === 'PENDING').map((i) => i.id);
    await removePendingJobs(pending);
    await req.db.batchItem.updateMany({
      where: { id: { in: pending } },
      data: { status: 'ERROR', error: 'cancelado' },
    });
    await req.db.batch.updateMany({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    return { status: 'CANCELLED' };
  });
}
