import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { MlListingError } from '@afilados/marketplaces';
import type { ProductData } from '@afilados/shared';
import { buildApp } from '../src/app';
import { mlListingDeps } from '../src/lib/ml-listing';
import { cleanupTenant, createTenantWithUser, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
const realFetch = mlListingDeps.fetchMlListing;
const fetchMock = vi.fn();
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;

const sample = (n: number, over: Partial<ProductData> = {}): ProductData => ({
  source: 'MERCADOLIVRE',
  externalId: `MLB${n}`,
  title: `Produto ${n}`,
  price: 100 + n,
  originalPrice: 200,
  discountPct: 50,
  images: ['https://http2.mlstatic.com/D_1.webp'],
  shipping: 'FULL',
  originalUrl: `https://www.mercadolivre.com.br/produto/p/MLB${n}`,
  raw: { origin: 'ml-listing' },
  ...over,
});

const search = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/products/search', headers: { cookie }, payload });

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
beforeEach(() => {
  fetchMock.mockReset();
  mlListingDeps.fetchMlListing = fetchMock as unknown as typeof realFetch;
});
afterAll(async () => {
  mlListingDeps.fetchMlListing = realFetch;
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('POST /products/search (listing do ML)', () => {
  it('devolve e persiste os produtos da listagem', async () => {
    fetchMock.mockResolvedValue([sample(1), sample(2)]);
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'category', categoryId: 'MLB1051' },
      limit: 20,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().products).toHaveLength(2);
    expect(typeof r.json().products[0].price).toBe('number');
    expect(await prisma.product.count({ where: { tenantId: t.tenantId } })).toBe(2);
    const [source, opts] = fetchMock.mock.calls[0] as [
      unknown,
      { limit: number; cookies?: unknown },
    ];
    expect(source).toEqual({ kind: 'category', categoryId: 'MLB1051' });
    expect(opts.limit).toBe(20);
    expect(opts.cookies).toBeUndefined();
  });

  it('usa os cookies da sessão sincronizada do ML quando existem', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: t.tenantId,
        kind: 'MERCADOLIVRE',
        encryptedCredentials: encryptJson({
          mlSession: {
            cookies: { ssid: 'abc' },
            syncedAt: '2026-10-05T00:00:00Z',
            source: 'manual',
          },
        }),
      },
    });
    fetchMock.mockResolvedValue([sample(3)]);
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]?.[1] as { cookies?: unknown }).cookies).toEqual({
      ssid: 'abc',
    });
    await prisma.marketplaceConnection.deleteMany({ where: { tenantId: t.tenantId } });
  });

  it('passa um filtro que aplica desconto mínimo, preço e frete grátis', async () => {
    fetchMock.mockResolvedValue([]);
    await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'lightning' },
      minDiscountPct: 40,
      maxPrice: 300,
      freeShippingOnly: true,
    });
    const filter = (fetchMock.mock.calls[0]?.[1] as { filter: (p: ProductData) => boolean }).filter;
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'FREE' }))).toBe(true);
    expect(filter(sample(1, { discountPct: 10, price: 100, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 400, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'FULL' }))).toBe(false);
    // Full com "grátis" no texto do card conta como frete grátis
    expect(
      filter(
        sample(1, {
          discountPct: 50,
          price: 100,
          shipping: 'FULL',
          raw: { origin: 'ml-listing', freeShipping: true },
        }),
      ),
    ).toBe(true);
  });

  it('bloqueio do ML → 502 com orientação para sincronizar a sessão', async () => {
    fetchMock.mockRejectedValue(new MlListingError('x', 'ML_LISTING_BLOCKED'));
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/Afilados Connect/);
  });

  it('layout mudou → 502 com mensagem clara', async () => {
    fetchMock.mockRejectedValue(new MlListingError('x', 'ML_LISTING_LAYOUT', 'url (10 bytes)'));
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/layout/i);
  });

  it.each([
    ['erro genérico', () => new Error('fetch failed: https://internal')],
    [
      'ML_LISTING_HTTP',
      () =>
        new MlListingError('HTTP 500 em https://internal', 'ML_LISTING_HTTP', 'https://internal'),
    ],
  ])('%s → 502 com mensagem genérica, sem vazar detalhes', async (_nome, makeErr) => {
    fetchMock.mockRejectedValue(makeErr());
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toBe(
      'Não foi possível ler a listagem do Mercado Livre agora; tente de novo em instantes',
    );
    expect(r.body).not.toMatch(/internal/);
  });

  it('entrada inválida da listagem → 400', async () => {
    fetchMock.mockRejectedValue(
      new MlListingError('Categoria do Mercado Livre inválida', 'ML_LISTING_INVALID_URL'),
    );
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'category', categoryId: 'MLB1051' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('não aceita mais a colagem de URL de listagem → 400 e nenhuma busca no ML', async () => {
    const r = await search({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/ofertas' },
    });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita listing fora do Mercado Livre e sem mlListing', async () => {
    expect(
      (await search({ source: 'SHOPEE', mode: 'listing', mlListing: { kind: 'deals' } }))
        .statusCode,
    ).toBe(400);
    expect((await search({ source: 'MERCADOLIVRE', mode: 'listing' })).statusCode).toBe(400);
  });
});
