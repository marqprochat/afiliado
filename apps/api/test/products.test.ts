import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { QUEUE_PRODUCT_ENRICH, type ProductEnrichJob } from '@afilados/shared';
import { getShopeeAdapter } from '../src/lib/marketplaces';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

process.env.SHOPEE_MOCK = '1';
const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
  await app.inject({
    method: 'PUT',
    url: '/api/v1/marketplaces/SHOPEE',
    headers: { cookie },
    payload: { appId: 'a', secret: 's' },
  });
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('products + queue', () => {
  let ids: string[] = [];
  it('search sem Shopee configurada → SHOPEE_UNCONFIGURED', async () => {
    const o = await createTenantWithUser('semshopee');
    const c = await loginCookie(app, o.email, o.password);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/search',
      headers: { cookie: c },
      payload: { source: 'SHOPEE', mode: 'trending' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('SHOPEE_UNCONFIGURED');
    await cleanupTenant(o.tenantId);
  });
  it('search persiste produtos (mock) e devolve números', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/search',
      headers: { cookie },
      payload: { source: 'SHOPEE', mode: 'keyword', query: 'ryzen' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(2);
    expect(typeof r.json().products[0].price).toBe('number');
    ids = r.json().products.map((p: { id: string }) => p.id);
    expect(await prisma.product.count({ where: { tenantId: t.tenantId } })).toBe(2);
  });
  it('search repetida não duplica', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/products/search',
      headers: { cookie },
      payload: { source: 'SHOPEE', mode: 'keyword', query: 'ryzen' },
    });
    expect(await prisma.product.count({ where: { tenantId: t.tenantId } })).toBe(2);
  });
  it('import separa suportados e não suportados', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { cookie },
      payload: {
        urls: [
          'https://shopee.com.br/x-i.123456.987654',
          'https://meli.la/abc',
          'https://globo.com/noticia',
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(1);
    expect(r.json().unsupported).toHaveLength(2);
  });
  it('import em lote de ML/Amazon enfileira enriquecimento em background', async () => {
    const queue = getQueue<ProductEnrichJob>(QUEUE_PRODUCT_ENRICH);
    await queue.drain();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { cookie },
      payload: {
        urls: [
          'https://produto.mercadolivre.com.br/MLB-4242424242-produto.html',
          'https://www.amazon.com.br/dp/B0ZZZZZZZ1',
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.queued).toBe(2);
    expect(body.products).toHaveLength(2);
    expect(body.products[0].title).toBe('Importando…');
    expect(body.products[0].raw.pendingEnrich).toBe(true);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
    const mine = jobs.filter((j) => j.data.tenantId === t.tenantId);
    expect(mine.map((j) => j.data.marketplaceKind).sort()).toEqual(['AMAZON', 'MERCADOLIVRE']);
    // um worker real pode já ter pegado o job; a remoção é só limpeza
    for (const j of mine) await j.remove().catch(() => {});

    // GET /products?ids= devolve os esqueletos; ao entrar na fila ficam PENDING_ENRICH
    const ids = body.products.map((p: { id: string }) => p.id);
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/products?ids=${ids.join(',')}`,
      headers: { cookie },
    });
    expect(get.json().products).toHaveLength(2);
    await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: ids },
    });
    const q = await app.inject({ method: 'GET', url: '/api/v1/queue', headers: { cookie } });
    const statuses = q
      .json()
      .items.filter((i: { productId: string }) => ids.includes(i.productId))
      .map((i: { status: string }) => i.status);
    expect(statuses).toEqual(['PENDING_ENRICH', 'PENDING_ENRICH']);
    // limpa a fila para não interferir no teste de limite abaixo
    for (const i of q.json().items) {
      await app.inject({ method: 'DELETE', url: `/api/v1/queue/${i.id}`, headers: { cookie } });
    }
  });
  it('import CSV multipart', async () => {
    const boundary = 'xxBOUNDARYxx';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="p.csv"',
      'Content-Type: text/csv',
      '',
      'url,titulo',
      'https://shopee.com.br/product/789012/555555,SSD',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(1);
  });
  it('falha do adapter no import → 502 MARKETPLACE_ERROR', async () => {
    const adapter = getShopeeAdapter();
    const spy = vi.spyOn(adapter, 'fetchByUrls').mockRejectedValueOnce(new Error('api down'));
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { cookie },
      payload: { urls: ['https://shopee.com.br/x-i.1.2'] },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toEqual({ code: 'MARKETPLACE_ERROR', message: 'api down' });
    spy.mockRestore();
  });
  it('fila: adiciona, lista, respeita limite, seleciona, remove', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { queueLimit: 2 },
    });
    const add = await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: ids },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toEqual({ added: 2, count: 2 });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: ids },
    });
    expect(again.json()).toEqual({ added: 0, count: 2 });
    const third = await prisma.product.findFirstOrThrow({
      where: { tenantId: t.tenantId, id: { notIn: ids } },
    });
    const full = await app.inject({
      method: 'POST',
      url: '/api/v1/queue',
      headers: { cookie },
      payload: { productIds: [third.id] },
    });
    expect(full.statusCode).toBe(400);
    expect(full.json().error.code).toBe('QUEUE_FULL');
    const list = await app.inject({ method: 'GET', url: '/api/v1/queue', headers: { cookie } });
    expect(list.json()).toMatchObject({ limit: 2, count: 2 });
    expect(list.json().items[0].product.title).toBeTruthy();
    const qid = list.json().items[0].id;
    const sel = await app.inject({
      method: 'POST',
      url: '/api/v1/queue/select',
      headers: { cookie },
      payload: { ids: [qid], selected: false },
    });
    expect(sel.json()).toEqual({ updated: 1 });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/queue/${qid}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/queue', headers: { cookie } })).json().count,
    ).toBe(1);
  });
});
