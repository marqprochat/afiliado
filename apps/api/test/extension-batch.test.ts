import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const MIN = 60_000;

describe('extensão: enviar produto direto para um lote', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let auth: { authorization: string };
  let sessionId: string;
  let templateId: string;
  let n = 0;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Extensao Lote');
    // sem janela de operação, os horários agendados ficam determinísticos
    await prisma.operatingWindow.update({
      where: { tenantId: t.tenantId },
      data: { enabled: false },
    });
    const cookie = await loginCookie(app, t.email, t.password);
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Chrome' },
    });
    auth = { authorization: `Bearer ${tokenRes.json().token}` };
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
    await app.close();
  });

  async function makeProduct() {
    n++;
    return prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'MAGALU',
        externalId: `ext-${n}-${Date.now()}`,
        title: `Produto ${n}`,
        price: 10,
        images: [],
        originalUrl: `https://www.magazineluiza.com.br/produto-${n}/p/abc${n}/`,
        raw: {},
      },
    });
  }

  /** Cria um lote com N itens pendentes, o primeiro em `firstRunAt`, espaçados por `intervalMin`. */
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
    const sent: string[] = [];
    for (let i = 0; i < (opts.sent ?? 0); i++) {
      const p = await makeProduct();
      const it = await prisma.batchItem.create({
        data: {
          batchId: batch.id,
          productId: p.id,
          order: order++,
          status: 'SENT',
          runAt: new Date(first.getTime() - (opts.sent! - i) * intervalMin * MIN),
        },
      });
      sent.push(it.id);
    }
    const pending: string[] = [];
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
      pending.push(it.id);
    }
    return { batch, sent, pending };
  }

  const capture = (batchId: string | null, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: auth,
      payload: {
        url: `https://www.magazineluiza.com.br/novo-${Date.now()}-${Math.random()}/p/zz${n}/`,
        marketplaceKind: 'MAGALU',
        title: 'Produto capturado',
        price: 99.9,
        ...(batchId ? { batchId } : {}),
        ...extra,
      },
    });

  const pendingItems = (batchId: string) =>
    prisma.batchItem.findMany({
      where: { batchId, status: 'PENDING' },
      orderBy: { order: 'asc' },
      include: { product: true },
    });

  describe('GET /extension/batches', () => {
    it('lista só lotes ativos, com a contagem de pendentes', async () => {
      const sched = await makeBatch('SCHEDULED', 2);
      const paused = await makeBatch('PAUSED', 1);
      await makeBatch('DONE', 0, { sent: 1 });
      await makeBatch('CANCELLED', 1);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/extension/batches',
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      const list = res.json() as { id: string; name: string; status: string; pending: number }[];
      expect(list.map((b) => b.id).sort()).toEqual([sched.batch.id, paused.batch.id].sort());
      expect(list.find((b) => b.id === sched.batch.id)).toMatchObject({
        status: 'SCHEDULED',
        pending: 2,
      });
      expect(list.find((b) => b.id === paused.batch.id)).toMatchObject({
        status: 'PAUSED',
        pending: 1,
      });
    });

    it('exige token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/extension/batches' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /extension/capture com batchId', () => {
    it('lote pausado: entra como primeiro pendente e não enfileira nada', async () => {
      const { batch, pending } = await makeBatch('PAUSED', 2);

      const res = await capture(batch.id);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, batchItem: { batchId: batch.id, runAt: null } });

      const items = await pendingItems(batch.id);
      expect(items).toHaveLength(3);
      expect(items[0]!.product?.title).toBe('Produto capturado');
      expect(items.slice(1).map((i) => i.id)).toEqual(pending);

      const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
      expect(await q.getJob(items[0]!.id)).toBeFalsy();
      // não cai na Triagem
      expect(await prisma.queueItem.count({ where: { tenantId: t.tenantId } })).toBe(0);
    });

    it('lote agendado: fura a fila, empurra os demais um intervalo e reenfileira', async () => {
      const first = new Date(Date.now() + 30 * MIN);
      const { batch, pending } = await makeBatch('SCHEDULED', 2, {
        firstRunAt: first,
        intervalMin: 10,
      });

      const res = await capture(batch.id);
      expect(res.statusCode).toBe(200);

      const items = await pendingItems(batch.id);
      expect(items).toHaveLength(3);
      expect(items[0]!.product?.title).toBe('Produto capturado');
      expect(items.slice(1).map((i) => i.id)).toEqual(pending);
      // novo item ocupa o horário do antigo primeiro; os demais andam 10 min cada
      expect(items.map((i) => i.runAt.getTime())).toEqual([
        first.getTime(),
        first.getTime() + 10 * MIN,
        first.getTime() + 20 * MIN,
      ]);

      const updated = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(updated.status).toBe('SCHEDULED');
      expect(updated.estimatedEndAt?.getTime()).toBe(first.getTime() + 20 * MIN);

      const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
      for (const it of items) {
        const job = await q.getJob(it.id);
        expect(job, `job do item ${it.id}`).toBeTruthy();
      }
    });

    it('primeiro pendente já vencido: começa agora em vez de agendar no passado', async () => {
      const past = new Date(Date.now() - 5 * MIN);
      const { batch } = await makeBatch('RUNNING', 1, { firstRunAt: past, intervalMin: 10 });

      const before = Date.now();
      const res = await capture(batch.id);
      expect(res.statusCode).toBe(200);

      const items = await pendingItems(batch.id);
      expect(items[0]!.runAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(items[1]!.runAt.getTime() - items[0]!.runAt.getTime()).toBe(10 * MIN);
      const updated = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(updated.status).toBe('RUNNING');
    });

    it('lote sem pendentes: sai no último envio + intervalo (ou agora, o que for mais tarde)', async () => {
      const { batch } = await makeBatch('RUNNING', 0, {
        sent: 1,
        firstRunAt: new Date(Date.now() + 60 * MIN),
        intervalMin: 10,
      });
      const lastSent = await prisma.batchItem.findFirstOrThrow({
        where: { batchId: batch.id, status: 'SENT' },
      });

      const res = await capture(batch.id);
      expect(res.statusCode).toBe(200);
      const items = await pendingItems(batch.id);
      expect(items).toHaveLength(1);
      expect(items[0]!.runAt.getTime()).toBe(lastSent.runAt.getTime() + 10 * MIN);
      expect(items[0]!.order).toBeGreaterThan(lastSent.order);
    });

    it('produto já pendente no lote → 409 BATCH_DUPLICATE', async () => {
      const { batch } = await makeBatch('SCHEDULED', 1);
      const url = 'https://www.magazineluiza.com.br/repetido/p/rep1/';
      const first = await capture(batch.id, { url });
      expect(first.statusCode).toBe(200);
      const second = await capture(batch.id, { url });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ error: { code: 'BATCH_DUPLICATE' } });
      expect(await pendingItems(batch.id)).toHaveLength(2);
    });

    it('lote concluído/cancelado → 409 BATCH_INACTIVE', async () => {
      const done = await makeBatch('DONE', 0, { sent: 1 });
      const cancelled = await makeBatch('CANCELLED', 1);
      for (const b of [done.batch, cancelled.batch]) {
        const res = await capture(b.id);
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ error: { code: 'BATCH_INACTIVE' } });
      }
    });

    it('lote de outro tenant ou inexistente → 404', async () => {
      const other = await createTenantWithUser('Outro Tenant Lote');
      try {
        const s = await prisma.waSession.create({ data: { tenantId: other.tenantId, label: 'o' } });
        const tpl = await prisma.template.findFirstOrThrow({ where: { tenantId: other.tenantId } });
        const foreign = await prisma.batch.create({
          data: {
            tenantId: other.tenantId,
            sessionId: s.id,
            templateId: tpl.id,
            name: 'alheio',
            groupJids: [],
            intervalMin: 10,
            status: 'PAUSED',
          },
        });
        expect((await capture(foreign.id)).statusCode).toBe(404);
        expect((await capture('nao-existe')).statusCode).toBe(404);
      } finally {
        await cleanupTenant(other.tenantId);
      }
    });

    it('batchId junto com automationRuleId → 400', async () => {
      const { batch } = await makeBatch('PAUSED', 0);
      const res = await capture(batch.id, { automationRuleId: 'qualquer' });
      expect(res.statusCode).toBe(400);
    });

    it('sem batchId continua indo para a Triagem', async () => {
      const res = await capture(null);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ queueItem: { selected: true, status: 'PENDING' } });
    });
  });
});
