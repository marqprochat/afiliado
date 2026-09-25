import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@afilados/db';
import { scheduleBatch, shuffleInterleaved } from '@afilados/core';
import {
  ApiError,
  batchAddItemsSchema,
  batchCreateSchema,
  batchOrderSchema,
  batchUpdateSchema,
} from '@afilados/shared';
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

async function findPausedBatch(req: FastifyRequest) {
  const b = await findBatch(req);
  if (b.status !== 'PAUSED') throw new ApiError('VALIDATION', 'Pause o lote antes de editar', 409);
  return b;
}

async function assertTargets(
  req: FastifyRequest,
  sessionId: string,
  t: {
    groupJids?: string[] | undefined;
    telegramChatIds?: string[] | undefined;
    templateId?: string | undefined;
  },
) {
  if (t.groupJids) {
    const groups = await req.db.waGroup.findMany({
      where: { sessionId, jid: { in: t.groupJids } },
      select: { jid: true },
    });
    const known = new Set(groups.map((g) => g.jid));
    const unknown = t.groupJids.filter((j) => !known.has(j));
    if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
  }
  if (t.telegramChatIds?.length) {
    const chats = await req.db.telegramChat.findMany({
      where: { chatId: { in: t.telegramChatIds } },
      select: { chatId: true },
    });
    const knownChats = new Set(chats.map((c) => c.chatId));
    const unknownChats = t.telegramChatIds.filter((c) => !knownChats.has(c));
    if (unknownChats.length) {
      throw ApiError.validation(`Chats do Telegram desconhecidos: ${unknownChats.join(', ')}`);
    }
  }
  if (t.templateId) {
    const template = await req.db.template.findFirst({ where: { id: t.templateId } });
    if (!template) throw ApiError.notFound('Template não encontrado');
  }
}

export async function batchesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/batches', async (req, reply) => {
    const body = batchCreateSchema.parse(req.body);
    const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
    if (!session) throw ApiError.notFound('Sessão não encontrada');
    if (session.status !== 'CONNECTED')
      throw new ApiError('WA_NOT_CONNECTED', 'WhatsApp não está conectado', 400);
    await assertTargets(req, session.id, body);

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
        templateId: body.templateId,
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
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: {
            product: true,
            coupon: true,
            sendLogs: {
              select: { groupJid: true, status: true, error: true, sentAt: true },
              orderBy: { sentAt: 'asc' },
            },
          },
        },
      },
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
    if (pending.length === 0) {
      await req.db.batch.updateMany({ where: { id: b.id }, data: { status: 'DONE' } });
      return { status: 'DONE', estimatedEndAt: b.estimatedEndAt };
    }
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

  app.patch('/batches/:id', async (req) => {
    const body = batchUpdateSchema.parse(req.body);
    const b = await findPausedBatch(req);
    await assertTargets(req, b.sessionId, body);
    const data = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as Prisma.BatchUncheckedUpdateInput;
    await req.db.batch.update({ where: { id: b.id }, data });
    return { ok: true };
  });

  app.put('/batches/:id/order', async (req) => {
    const { itemIds } = batchOrderSchema.parse(req.body);
    const b = await findPausedBatch(req);
    const pending = b.items.filter((i) => i.status === 'PENDING');
    const pendingIds = new Set(pending.map((i) => i.id));
    if (itemIds.length !== pendingIds.size || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => pendingIds.has(id))) {
      throw ApiError.validation('A nova ordem precisa conter exatamente os itens pendentes do lote');
    }
    const base = Math.max(-1, ...b.items.filter((i) => i.status !== 'PENDING').map((i) => i.order)) + 1;
    await req.db.$transaction(
      itemIds.map((id, idx) =>
        req.db.batchItem.updateMany({ where: { id, batchId: b.id }, data: { order: base + idx } }),
      ),
    );
    return { ok: true };
  });

  app.post('/batches/:id/items', async (req) => {
    const { productIds } = batchAddItemsSchema.parse(req.body);
    const b = await findPausedBatch(req);
    const unique = [...new Set(productIds)];
    const products = await req.db.product.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    const found = new Set(products.map((p) => p.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length) throw ApiError.notFound(`Produtos não encontrados: ${missing.join(', ')}`);
    const already = new Set(b.items.map((i) => i.productId).filter(Boolean));
    const toAdd = unique.filter((id) => !already.has(id));
    const nextOrder = Math.max(-1, ...b.items.map((i) => i.order)) + 1;
    const now = new Date();
    if (toAdd.length) {
      await req.db.batchItem.createMany({
        data: toAdd.map((productId, idx) => ({
          batchId: b.id,
          productId,
          order: nextOrder + idx,
          runAt: now,
        })),
      });
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  });

  app.delete('/batches/:id/items/:itemId', async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string().min(1) }).parse(req.params);
    const b = await findPausedBatch(req);
    const item = b.items.find((i) => i.id === itemId);
    if (!item) throw ApiError.notFound('Item não encontrado neste lote');
    if (item.status === 'SENT' || item.status === 'SENDING') {
      throw new ApiError('VALIDATION', 'Item já enviado ou em envio não pode ser removido', 409);
    }
    await removePendingJobs([item.id]);
    await req.db.batchItem.deleteMany({ where: { id: item.id, batchId: b.id } });
    return reply.status(204).send();
  });

  app.delete('/batches/:id', async (req, reply) => {
    const b = await findBatch(req);
    if (b.status === 'SCHEDULED' || b.status === 'RUNNING') {
      throw new ApiError('VALIDATION', 'Pause ou cancele o lote antes de excluir', 409);
    }
    if (b.items.some((i) => i.status === 'SENDING')) {
      throw new ApiError('VALIDATION', 'Há um envio em andamento; aguarde', 409);
    }
    await removePendingJobs(b.items.filter((i) => i.status === 'PENDING').map((i) => i.id));
    await req.db.batch.deleteMany({ where: { id: b.id } });
    return reply.status(204).send();
  });
}
