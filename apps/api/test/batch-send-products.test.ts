import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const MIN = 60_000;

describe('POST /api/v1/batches/:id/send-products', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let otherT: Awaited<ReturnType<typeof createTenantWithUser>>;
  let cookie: string;
  let otherCookie: string;
  let sessionId: string;
  let templateId: string;
  let n = 0;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Send Products');
    otherT = await createTenantWithUser('Outro Tenant');
    // Janela desabilitada para horários determinísticos
    await prisma.operatingWindow.update({
      where: { tenantId: t.tenantId },
      data: { enabled: false },
    });
    cookie = await loginCookie(app, t.email, t.password);
    otherCookie = await loginCookie(app, otherT.email, otherT.password);

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

  async function makeProduct(tenantId = t.tenantId, status: 'PENDING' | 'PENDING_ENRICH' = 'PENDING') {
    n++;
    const p = await prisma.product.create({
      data: {
        tenantId,
        source: 'MAGALU',
        externalId: `ext-${n}-${Date.now()}`,
        title: `Produto ${n}`,
        price: 10 * n,
        images: [],
        originalUrl: `https://www.magazineluiza.com.br/produto-${n}/p/abc${n}/`,
        raw: {},
      },
    });
    await prisma.queueItem.create({
      data: {
        tenantId,
        productId: p.id,
        status,
      },
    });
    return p;
  }

  async function makeBatch(
    status: 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'CANCELLED',
    pendingCount: number,
    opts: { firstRunAt?: Date; intervalMin?: number; sent?: number } = {},
  ) {
    const intervalMin = opts.intervalMin ?? 10;
    const first = opts.firstRunAt ?? new Date(Date.now() + 30 * MIN);
    const batch = await prisma.batch.create({
      data: {
        tenantId: t.tenantId,
        sessionId,
        templateId,
        name: `Lote ${status}`,
        groupJids: ['g1@g.us'],
        intervalMin,
        status,
      },
    });
    let order = 0;
    for (let i = 0; i < (opts.sent ?? 0); i++) {
      const p = await makeProduct();
      await prisma.batchItem.create({
        data: {
          batchId: batch.id,
          productId: p.id,
          order: order++,
          status: 'SENT',
          runAt: new Date(first.getTime() - (opts.sent! - i) * intervalMin * MIN),
        },
      });
    }
    const pendingItems = [];
    for (let i = 0; i < pendingCount; i++) {
      const p = await makeProduct();
      const it = await prisma.batchItem.create({
        data: {
          batchId: batch.id,
          productId: p.id,
          order: order++,
          status: 'PENDING',
          runAt: new Date(first.getTime() + i * intervalMin * MIN),
        },
      });
      pendingItems.push(it);
    }
    return { batch, pendingItems };
  }

  it('end: adiciona novos produtos no fim da fila de pendentes', async () => {
    const { batch, pendingItems } = await makeBatch('RUNNING', 2);
    const p1 = await makeProduct();
    const p2 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id, p2.id], position: 'end' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data).toMatchObject({
      added: 2,
      skipped: 0,
      status: 'RUNNING',
      reactivated: false,
    });

    const items = await prisma.batchItem.findMany({
      where: { batchId: batch.id },
      orderBy: { order: 'asc' },
    });
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.productId)).toEqual([
      pendingItems[0]!.productId,
      pendingItems[1]!.productId,
      p1.id,
      p2.id,
    ]);

    // Jobs no Redis
    const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
    for (const item of items) {
      const job = await q.getJob(item.id);
      expect(job).not.toBeNull();
    }
  });

  it('start: adiciona novos produtos no início da fila de pendentes e desloca existentes', async () => {
    const { batch, pendingItems } = await makeBatch('RUNNING', 2);
    const p1 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id], position: 'start' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.added).toBe(1);

    const items = await prisma.batchItem.findMany({
      where: { batchId: batch.id },
      orderBy: { order: 'asc' },
    });
    expect(items.map((i) => i.productId)).toEqual([
      p1.id,
      pendingItems[0]!.productId,
      pendingItems[1]!.productId,
    ]);
  });

  it('shuffle: novos entram intercalados preservando ordem relativa dos pendentes', async () => {
    const { batch, pendingItems } = await makeBatch('RUNNING', 3);
    const p1 = await makeProduct();
    const p2 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id, p2.id], position: 'shuffle' },
    });

    expect(res.statusCode).toBe(200);
    const items = await prisma.batchItem.findMany({
      where: { batchId: batch.id },
      orderBy: { order: 'asc' },
    });
    expect(items).toHaveLength(5);

    // Ordem relativa dos pendentes originais
    const originalPendingIds = pendingItems.map((i) => i.productId);
    const filteredPendingInResult = items
      .map((i) => i.productId)
      .filter((id) => originalPendingIds.includes(id));
    expect(filteredPendingInResult).toEqual(originalPendingIds);
  });

  it('lote DONE: reativa para SCHEDULED, reactivated=true e agenda a partir do último envio', async () => {
    const lastSentDate = new Date(Date.now() - 5 * MIN);
    const { batch } = await makeBatch('DONE', 0, { sent: 2, firstRunAt: lastSentDate, intervalMin: 10 });
    const p1 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id], position: 'end' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.status).toBe('SCHEDULED');
    expect(data.reactivated).toBe(true);
    expect(data.added).toBe(1);

    const updatedBatch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.status).toBe('SCHEDULED');

    const createdItem = await prisma.batchItem.findFirstOrThrow({
      where: { batchId: batch.id, productId: p1.id },
    });
    expect(createdItem.status).toBe('PENDING');

    const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
    const job = await q.getJob(createdItem.id);
    expect(job).not.toBeNull();
  });

  it('lote PAUSED: adiciona itens sem enfileirar jobs nem alterar estimatedEndAt', async () => {
    const { batch } = await makeBatch('PAUSED', 1);
    const p1 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id], position: 'end' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.status).toBe('PAUSED');
    expect(data.reactivated).toBe(false);

    const createdItem = await prisma.batchItem.findFirstOrThrow({
      where: { batchId: batch.id, productId: p1.id },
    });

    const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
    const job = await q.getJob(createdItem.id);
    expect(job).toBeFalsy();
  });

  it('lote CANCELLED: retorna 409 BATCH_INACTIVE', async () => {
    const { batch } = await makeBatch('CANCELLED', 0);
    const p1 = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BATCH_INACTIVE');
  });

  it('produto já presente no lote (inclusive SENT) é pulado e somado em skipped', async () => {
    const { batch, pendingItems } = await makeBatch('RUNNING', 1, { sent: 1 });
    const existingSentItem = (await prisma.batchItem.findFirstOrThrow({
      where: { batchId: batch.id, status: 'SENT' },
    }));
    const newProduct = await makeProduct();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: {
        productIds: [existingSentItem.productId, pendingItems[0]!.productId, newProduct.id],
      },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.added).toBe(1);
    expect(data.skipped).toBe(2);
  });

  it('produto com status PENDING_ENRICH: retorna 409 PRODUCT_NOT_READY', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const enrichingProduct = await makeProduct(t.tenantId, 'PENDING_ENRICH');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [enrichingProduct.id] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PRODUCT_NOT_READY');
  });

  it('produto ou lote de outro tenant: retorna 404', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const otherProduct = await makeProduct(otherT.tenantId);

    // Produto de outro tenant
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [otherProduct.id] },
    });
    expect(res1.statusCode).toBe(404);

    // Lote de outro tenant
    const p = await makeProduct();
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie: otherCookie },
      payload: { productIds: [p.id] },
    });
    expect(res2.statusCode).toBe(404);
  });

  it('falha ao enfileirar no Redis: pausa o lote e retorna 500 INTERNAL', async () => {
    const { batch } = await makeBatch('RUNNING', 1);
    const p1 = await makeProduct();

    vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValueOnce(new Error('Redis connection failed'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batch.id}/send-products`,
      headers: { cookie },
      payload: { productIds: [p1.id] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL');

    const updatedBatch = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.status).toBe('PAUSED');
  });

});
