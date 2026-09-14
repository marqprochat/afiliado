import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
import { buildApp } from '../src/app';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

process.env.SHOPEE_MOCK = '1';
const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
  await getQueue(QUEUE_SEND_OFFER).drain();
  const s = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 'c', status: 'CONNECTED' },
  });
  sessionId = s.id;
  await prisma.waGroup.createMany({
    data: [
      { tenantId: t.tenantId, sessionId, jid: 'g1@g.us', name: 'G1' },
      { tenantId: t.tenantId, sessionId, jid: 'g2@g.us', name: 'G2' },
    ],
  });
  templateId = (await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })).id;
  await app.inject({
    method: 'PUT',
    url: '/api/v1/marketplaces/SHOPEE',
    headers: { cookie },
    payload: { appId: 'a', secret: 's' },
  });
  const search = await app.inject({
    method: 'POST',
    url: '/api/v1/products/search',
    headers: { cookie },
    payload: { source: 'SHOPEE', mode: 'trending' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/v1/queue',
    headers: { cookie },
    payload: { productIds: search.json().products.map((p: { id: string }) => p.id) },
  });
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('templates', () => {
  it('preview renderiza com produto de exemplo', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/templates/preview',
      headers: { cookie },
      payload: { body: '*{titulo}* {preco} {link}' },
    });
    expect(r.json().text).toMatch(/^\*.+\* R\$ [\d.,]+ https:\/\/s\.shopee\.com\.br\/exemplo$/);
  });
  it('novo default desmarca o anterior', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { cookie },
      payload: { name: 'B', body: '{link}', isDefault: true },
    });
    expect(r.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: { cookie } });
    expect(list.json().filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);
  });
});

describe('batches', () => {
  let batchId: string;
  it('sessão desconectada → WA_NOT_CONNECTED', async () => {
    const off = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 'off' } });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/batches',
      headers: { cookie },
      payload: { name: 'x', sessionId: off.id, templateId, groupJids: ['g1@g.us'], intervalMin: 1 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('WA_NOT_CONNECTED');
  });
  it('grupo desconhecido → VALIDATION', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/batches',
      headers: { cookie },
      payload: { name: 'x', sessionId, templateId, groupJids: ['zz@g.us'], intervalMin: 1 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION');
  });
  it('cria lote com a fila selecionada, agenda e enfileira um job por item', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/batches',
      headers: { cookie },
      payload: {
        name: 'Lote 1',
        sessionId,
        templateId,
        groupJids: ['g1@g.us', 'g2@g.us'],
        intervalMin: 10,
        shuffled: true,
      },
    });
    expect(r.statusCode).toBe(201);
    batchId = r.json().batch.id;
    expect(r.json().items).toHaveLength(2);
    const [a, b] = r.json().items.map((i: { runAt: string }) => new Date(i.runAt).getTime());
    expect(b - a).toBe(10 * 60_000);
    expect(r.json().batch.estimatedEndAt).toBe(r.json().items[1].runAt);
    const jobs = await getQueue<SendOfferJob>(QUEUE_SEND_OFFER).getJobs(['waiting', 'delayed']);
    const ours = jobs.filter((j) => j.data.tenantId === t.tenantId);
    expect(ours.map((j) => j.id).sort()).toEqual(
      r
        .json()
        .items.map((i: { id: string }) => i.id)
        .sort(),
    );
  });
  it('pause remove jobs; resume re-enfileira; cancel marca ERROR', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batchId}/pause`,
      headers: { cookie },
    });
    let jobs = await getQueue<SendOfferJob>(QUEUE_SEND_OFFER).getJobs(['waiting', 'delayed']);
    expect(jobs.filter((j) => j.data.tenantId === t.tenantId)).toHaveLength(0);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe(
      'PAUSED',
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batchId}/resume`,
      headers: { cookie },
    });
    jobs = await getQueue<SendOfferJob>(QUEUE_SEND_OFFER).getJobs(['waiting', 'delayed']);
    expect(jobs.filter((j) => j.data.tenantId === t.tenantId)).toHaveLength(2);
    await app.inject({
      method: 'POST',
      url: `/api/v1/batches/${batchId}/cancel`,
      headers: { cookie },
    });
    const b = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      include: { items: true },
    });
    expect(b.status).toBe('CANCELLED');
    expect(b.items.every((i) => i.status === 'ERROR')).toBe(true);
  });
  it('overview agrega estado', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/overview', headers: { cookie } });
    expect(r.json()).toMatchObject({ shopee: 'UNCONFIGURED', queue: { count: 2, limit: 500 } });
    expect(r.json().wa.some((s: { id: string }) => s.id === sessionId)).toBe(true);
  });
});
