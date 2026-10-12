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
