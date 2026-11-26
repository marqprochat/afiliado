import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { QUEUE_AWIN_PROGRAMME_STATS } from '@afilados/shared';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

// A API não sobe worker nos testes: a fila dos indicadores é substituída por um registro das chamadas.
const fake = vi.hoisted(() => ({ adds: [] as { name: string; data: unknown; opts: any }[] }));
vi.mock('../src/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/redis')>();
  return {
    ...actual,
    getQueue: ((name: string) => {
      if (name !== 'awin-programme-stats') return actual.getQueue(name);
      return {
        add: async (jobName: string, data: unknown, opts: unknown) => {
          fake.adds.push({ name: jobName, data, opts });
          return { id: (opts as { jobId: string }).jobId };
        },
      };
    }) as typeof actual.getQueue,
  };
});

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let child: Awaited<ReturnType<typeof createTenantWithUser>>;
let ownerCookie: string;
let childCookie: string;

const FETCHED = new Date('2026-11-26T06:00:00.000Z');

beforeAll(async () => {
  owner = await createTenantWithUser('awin-stats-owner');
  child = await createTenantWithUser('awin-stats-child', owner.tenantId);
  ownerCookie = await loginCookie(app, owner.email, owner.password);
  childCookie = await loginCookie(app, child.email, child.password);
  await prisma.awinProgrammeStats.createMany({
    data: [
      { tenantId: owner.tenantId, advertiserId: '1', name: 'Loja Sem EPC', fetchedAt: FETCHED },
      {
        tenantId: owner.tenantId,
        advertiserId: '2',
        name: 'Drogal BR',
        currency: 'BRL',
        epc: 0.42,
        approvalPercentage: 90,
        conversionRate: 3.1,
        averagePaymentTime: 45,
        commissionMin: 2,
        commissionMax: 8,
        commissionType: 'percentage',
        score: 0.378,
        fetchedAt: FETCHED,
      },
      {
        tenantId: owner.tenantId,
        advertiserId: '3',
        name: 'Loja Top',
        currency: 'BRL',
        epc: 1,
        score: 0.8,
        fetchedAt: FETCHED,
      },
    ],
  });
  const product = (advertiserId: string | null, advertiserName: string, externalId: string) => ({
    tenantId: owner.tenantId,
    feedId: 'f1',
    advertiserId,
    advertiserName,
    externalId,
    title: `Produto ${externalId}`,
    price: 10,
    deepLink: `https://www.awin1.com/cread.php?x=${externalId}`,
    raw: {},
  });
  await prisma.awinCatalogProduct.createMany({
    data: [
      product('2', 'Drogal BR', 'a'),
      product(null, 'Loja Top', 'b'),
      product('99', 'Avulsa', 'c'),
      product('1', 'Loja Sem EPC', 'd'),
    ],
  });
});

beforeEach(() => {
  fake.adds.length = 0;
});

afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('GET /marketplaces/awin/programme-stats', () => {
  it('lista os indicadores ordenados por score (sem EPC no fim) com números', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/programme-stats',
      headers: { cookie: ownerCookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.items.map((i: { advertiserId: string }) => i.advertiserId)).toEqual([
      '3',
      '2',
      '1',
    ]);
    expect(body.items[1]).toMatchObject({
      name: 'Drogal BR',
      epc: 0.42,
      approvalPercentage: 90,
      conversionRate: 3.1,
      averagePaymentTime: 45,
      commissionMin: 2,
      commissionMax: 8,
      commissionType: 'percentage',
      score: 0.378,
      fetchedAt: FETCHED.toISOString(),
    });
    expect(body.items[2]).toMatchObject({ epc: null, score: null });
    expect(body.fetchedAt).toBe(FETCHED.toISOString());
  });

  it('afiliado lê os indicadores do dono', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/programme-stats',
      headers: { cookie: childCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(3);
  });

  it('exige login', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/marketplaces/awin/programme-stats' });
    expect(r.statusCode).toBe(401);
  });
});

describe('POST /marketplaces/awin/programme-stats/refresh', () => {
  it('sem publisherId/token da Awin → 400 e nada na fila', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/awin/programme-stats/refresh',
      headers: { cookie: ownerCookie },
    });
    expect(r.statusCode).toBe(400);
    expect(fake.adds).toHaveLength(0);
  });

  it('enfileira com jobId fixo por tenant (dedupe)', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: owner.tenantId,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({
          feedListUrl: 'https://ui.awin.com/f',
          feedIds: [],
          publisherId: '12345',
          offersApiToken: 'tok',
        }),
      },
    });
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/marketplaces/awin/programme-stats/refresh',
        headers: { cookie: ownerCookie },
      });
    const r1 = await call();
    const r2 = await call();
    expect(r1.statusCode).toBe(202);
    expect(r1.json()).toMatchObject({ queued: true });
    expect(r2.statusCode).toBe(202);
    expect(fake.adds).toHaveLength(2);
    expect(fake.adds[0]).toMatchObject({
      name: 'awin-programme-stats',
      data: { tenantId: owner.tenantId, trigger: 'manual' },
    });
    expect(fake.adds[0]!.opts.jobId).toBe(`awin-programme-stats-${owner.tenantId}-manual`);
    expect(fake.adds[1]!.opts.jobId).toBe(fake.adds[0]!.opts.jobId);
    expect(QUEUE_AWIN_PROGRAMME_STATS).toBe('awin-programme-stats');
  });

  it('afiliado não pode atualizar (403)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/awin/programme-stats/refresh',
      headers: { cookie: childCookie },
    });
    expect(r.statusCode).toBe(403);
    expect(fake.adds).toHaveLength(0);
  });
});

describe('GET /products/awin-stores', () => {
  it('lojas do catálogo ordenadas pelo score, com EPC; sem indicador no fim (A-Z)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/products/awin-stores',
      headers: { cookie: ownerCookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.stores).toEqual(['Loja Top', 'Drogal BR', 'Loja Sem EPC', 'Avulsa']);
    expect(body.items[0]).toMatchObject({ name: 'Loja Top', epc: 1, score: 0.8, currency: 'BRL' });
    expect(body.items[1]).toMatchObject({ name: 'Drogal BR', advertiserId: '2', epc: 0.42 });
    expect(body.items[3]).toMatchObject({ name: 'Avulsa', epc: null, score: null });
  });
});
