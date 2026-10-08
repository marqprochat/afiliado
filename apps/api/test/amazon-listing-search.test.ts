import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AmazonListingError } from '@afilados/marketplaces';
import type { ProductData } from '@afilados/shared';
import { buildApp } from '../src/app';
import { amazonListingDeps } from '../src/lib/amazon-listing';
import { cleanupTenant, createTenantWithUser, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
const realFetch = amazonListingDeps.fetchAmazonListing;
const fetchMock = vi.fn();
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;

const sample = (n: number, over: Partial<ProductData> = {}): ProductData => ({
  source: 'AMAZON',
  externalId: `B00000000${n}`,
  title: `Produto ${n}`,
  price: 100 + n,
  originalPrice: 200,
  discountPct: 50,
  images: ['https://m.media-amazon.com/images/I/1.jpg'],
  shipping: 'FREE',
  originalUrl: `https://www.amazon.com.br/dp/B00000000${n}`,
  raw: { origin: 'amazon-listing' },
  ...over,
});

const search = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/products/search', headers: { cookie }, payload });

const filterOf = () =>
  (fetchMock.mock.calls[0]?.[1] as { filter: (p: ProductData) => boolean }).filter;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
beforeEach(() => {
  fetchMock.mockReset();
  amazonListingDeps.fetchAmazonListing = fetchMock as unknown as typeof realFetch;
});
afterAll(async () => {
  amazonListingDeps.fetchAmazonListing = realFetch;
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('POST /products/search (listagem da Amazon)', () => {
  it('ofertas por palavra-chave: devolve e persiste, passando o termo como fonte', async () => {
    fetchMock.mockResolvedValue([sample(1), sample(2)]);
    const r = await search({
      source: 'AMAZON',
      mode: 'listing',
      amazonListing: { kind: 'deals' },
      query: 'celular',
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
    expect(source).toEqual({ kind: 'deals', query: 'celular' });
    expect(opts.limit).toBe(20);
    expect(opts.cookies).toBeUndefined();
  });

  it('Mega Oferta Prime: fonte sem termo', async () => {
    fetchMock.mockResolvedValue([sample(3)]);
    const r = await search({ source: 'AMAZON', mode: 'listing', amazonListing: { kind: 'mega' } });
    expect(r.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual({ kind: 'mega' });
  });

  it('ofertas por palavra-chave sem termo → 400 e nenhuma busca na Amazon', async () => {
    const r = await search({ source: 'AMAZON', mode: 'listing', amazonListing: { kind: 'deals' } });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa os cookies da sessão sincronizada da Amazon quando existem', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: t.tenantId,
        kind: 'AMAZON',
        encryptedCredentials: encryptJson({
          amazonSession: {
            cookies: { 'session-id': 'abc' },
            syncedAt: '2026-10-08T00:00:00Z',
            source: 'manual',
          },
        }),
      },
    });
    fetchMock.mockResolvedValue([sample(4)]);
    const r = await search({
      source: 'AMAZON',
      mode: 'listing',
      amazonListing: { kind: 'deals' },
      query: 'fone',
    });
    expect(r.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]?.[1] as { cookies?: unknown }).cookies).toEqual({
      'session-id': 'abc',
    });
    await prisma.marketplaceConnection.deleteMany({ where: { tenantId: t.tenantId } });
  });

  it('o filtro aplica desconto mínimo, preço e frete grátis', async () => {
    fetchMock.mockResolvedValue([]);
    await search({
      source: 'AMAZON',
      mode: 'listing',
      amazonListing: { kind: 'deals' },
      query: 'celular',
      minDiscountPct: 40,
      maxPrice: 300,
      freeShippingOnly: true,
    });
    const filter = filterOf();
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'FREE' }))).toBe(true);
    expect(filter(sample(1, { discountPct: 10, price: 100, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 400, shipping: 'FREE' }))).toBe(false);
    expect(filter(sample(1, { discountPct: 50, price: 100, shipping: 'UNKNOWN' }))).toBe(false);
  });

  it('em ofertas por palavra-chave o termo vai para a Amazon e não filtra o título', async () => {
    fetchMock.mockResolvedValue([]);
    await search({
      source: 'AMAZON',
      mode: 'listing',
      amazonListing: { kind: 'deals' },
      query: 'celular',
    });
    // "Galaxy S24" não contém "celular", mas a Amazon já casou pelo termo (sinônimos, categoria)
    expect(filterOf()(sample(1, { title: 'Smartphone Galaxy S24' }))).toBe(true);
  });

  it('na Mega Oferta Prime a palavra-chave filtra pelo título (sem acento e sem ordem)', async () => {
    fetchMock.mockResolvedValue([]);
    await search({
      source: 'AMAZON',
      mode: 'listing',
      amazonListing: { kind: 'mega' },
      query: '  camera SEGURANCA ',
    });
    const filter = filterOf();
    expect(filter(sample(1, { title: 'Câmera de Segurança Wifi' }))).toBe(true);
    expect(filter(sample(1, { title: 'Fone Bluetooth' }))).toBe(false);
  });

  it('bloqueio da Amazon → 502 com orientação para sincronizar a sessão', async () => {
    fetchMock.mockRejectedValue(new AmazonListingError('x', 'AMAZON_LISTING_BLOCKED'));
    const r = await search({ source: 'AMAZON', mode: 'listing', amazonListing: { kind: 'mega' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/Afilados Connect/);
  });

  it('layout mudou → 502 com mensagem clara', async () => {
    fetchMock.mockRejectedValue(
      new AmazonListingError('x', 'AMAZON_LISTING_LAYOUT', 'url (10 bytes)'),
    );
    const r = await search({ source: 'AMAZON', mode: 'listing', amazonListing: { kind: 'mega' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toMatch(/layout/i);
  });

  it.each([
    ['erro genérico', () => new Error('fetch failed: https://internal')],
    [
      'AMAZON_LISTING_HTTP',
      () =>
        new AmazonListingError(
          'HTTP 500 em https://internal',
          'AMAZON_LISTING_HTTP',
          'https://internal',
        ),
    ],
  ])('%s → 502 com mensagem genérica, sem vazar detalhes', async (_nome, makeErr) => {
    fetchMock.mockRejectedValue(makeErr());
    const r = await search({ source: 'AMAZON', mode: 'listing', amazonListing: { kind: 'mega' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toBe(
      'Não foi possível ler as ofertas da Amazon agora; tente de novo em instantes',
    );
    expect(r.body).not.toMatch(/internal/);
  });
});
