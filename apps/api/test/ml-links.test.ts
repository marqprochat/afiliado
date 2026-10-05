import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@afilados/db';
import { QUEUE_ML_LINKS_PREWARM, type MlLinksPrewarmJob } from '@afilados/shared';
import { mlLinksErrorKey } from '@afilados/marketplaces';
import { buildApp } from '../src/app';
import { getQueue, getRedis } from '../src/lib/redis';
import { cleanupTenant, createTenantWithUser, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
afterAll(async () => {
  await getRedis().del(mlLinksErrorKey(t.tenantId));
  await cleanupTenant(t.tenantId);
  await app.close();
});

const put = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/marketplaces/MERCADOLIVRE',
    headers: { cookie },
    payload,
  });

describe('etiqueta de afiliado do ML', () => {
  it('grava mlTag, expõe mlAffiliateTag e permite limpar com vazio', async () => {
    const r1 = await put({ mattWord: 'w', mattTool: '1', mlTag: ' minha-tag ' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().mlAffiliateTag).toBe('minha-tag');

    // preserva a etiqueta quando o campo não vem no corpo
    const r2 = await put({ mattWord: 'w2' });
    expect(r2.json().mlAffiliateTag).toBe('minha-tag');
    expect(r2.json().mattTool).toBe('1');

    const r3 = await put({ mlTag: '' });
    expect(r3.json().mlAffiliateTag).toBeNull();
    expect(r3.json().mattWord).toBe('w2');
  });

  it('outros marketplaces não expõem etiqueta do ML', async () => {
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlAffiliateTag: string | null }[];
    expect(list.find((m) => m.kind === 'AMAZON')?.mlAffiliateTag).toBeNull();
  });
});

describe('erro do gerador em lote no card do ML', () => {
  it('GET /marketplaces anexa o último erro só ao Mercado Livre', async () => {
    const err = {
      at: '2026-10-05T17:30:00.000Z',
      message: 'Gerador de links do ML respondeu HTTP 500',
      urls: 5,
      recoveredByFallback: 3,
    };
    await getRedis().set(mlLinksErrorKey(t.tenantId), JSON.stringify(err));
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlLinkBatchError?: unknown }[];
    expect(list.find((m) => m.kind === 'MERCADOLIVRE')?.mlLinkBatchError).toEqual(err);
    expect(list.find((m) => m.kind === 'SHOPEE')?.mlLinkBatchError).toBeUndefined();

    await getRedis().del(mlLinksErrorKey(t.tenantId));
    const after = (
      await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } })
    ).json() as { kind: string; mlLinkBatchError?: unknown }[];
    expect(after.find((m) => m.kind === 'MERCADOLIVRE')?.mlLinkBatchError).toBeNull();
  });
});

describe('pré-aquecimento ao salvar na fila', () => {
  it('POST /queue enfileira só as URLs de produtos do ML', async () => {
    const queue = getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM);
    await queue.drain();
    const ml = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'MERCADOLIVRE',
        externalId: 'MLB1234',
        title: 'Produto ML',
        price: 10,
        originalUrl: 'https://www.mercadolivre.com.br/produto/p/MLB1234',
        raw: {},
      },
    });
    const shopee = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'SHOPEE',
        externalId: '99',
        title: 'Produto Shopee',
        price: 10,
        originalUrl: 'https://shopee.com.br/x-i.1.99',
        raw: {},
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: [ml.id, shopee.id] },
    });
    expect(r.statusCode).toBe(201);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    const mine = jobs.filter((j) => j.data.tenantId === t.tenantId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.data.urls).toEqual(['https://www.mercadolivre.com.br/produto/p/MLB1234']);
    for (const j of mine) await j.remove().catch(() => {});
  });

  it('não enfileira nada quando não há produto do ML', async () => {
    const queue = getQueue<MlLinksPrewarmJob>(QUEUE_ML_LINKS_PREWARM);
    await queue.drain();
    const only = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'SHOPEE',
        externalId: '100',
        title: 'Outro',
        price: 10,
        originalUrl: 'https://shopee.com.br/x-i.1.100',
        raw: {},
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: [only.id] },
    });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    expect(jobs.filter((j) => j.data.tenantId === t.tenantId)).toHaveLength(0);
  });
});
