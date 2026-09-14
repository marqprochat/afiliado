import { describe, it, expect, vi } from 'vitest';
import { createShopeeAdapter } from '../src/shopee/adapter';
import offers from '../src/shopee/fixtures/productOfferV2.json';
import short from '../src/shopee/fixtures/generateShortLink.json';

const creds = { appId: 'app', secret: 'sec' };

function fakeFetch(bodies: unknown[]) {
  const queue = [...bodies];
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const body = queue.shift();
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

const baseQuery = {
  source: 'SHOPEE' as const,
  mode: 'keyword' as const,
  query: 'ryzen',
  sort: 'DISCOUNT_DESC' as const,
  limit: 100,
  topSellers: false,
  extraCommission: false,
};

describe('ShopeeAdapter (mock)', () => {
  const adapter = createShopeeAdapter({ mock: true });
  it('search devolve fixtures', async () => {
    const r = await adapter.search!(creds, baseQuery);
    expect(r).toHaveLength(2);
    expect(r[0]!.source).toBe('SHOPEE');
  });
  it('toAffiliateLink devolve link mock', async () => {
    expect(await adapter.toAffiliateLink(creds, 'https://shopee.com.br/product/1/2', 'sub')).toBe(
      'https://s.shopee.com.br/MOCK123',
    );
  });
  it('checkConnection ok', async () => {
    expect(await adapter.checkConnection(creds)).toEqual({ ok: true });
  });
});

describe('ShopeeAdapter (real, fetch falso)', () => {
  it('search envia header assinado e variáveis corretas', async () => {
    const f = fakeFetch([offers]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const r = await adapter.search!(creds, { ...baseQuery, sort: 'COMMISSION_DESC', limit: 10, topSellers: true });
    expect(r).toHaveLength(2);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^SHA256 Credential=app, Timestamp=\d+, Signature=[0-9a-f]{64}$/);
    const body = JSON.parse(init!.body as string) as { variables: Record<string, unknown> };
    expect(body.variables).toMatchObject({ keyword: 'ryzen', sortType: 3, limit: 10, isOfficialShop: true });
  });
  it('fetchByUrls resolve itemId da URL', async () => {
    const f = fakeFetch([offers]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const r = await adapter.fetchByUrls(creds, ['https://shopee.com.br/x-i.123456.987654']);
    expect(r[0]!.externalId).toBe('987654');
  });
  it('fetchByUrls ignora URL quando a API não devolve o itemId pedido', async () => {
    const f = fakeFetch([offers]); // fixture não contém itemId 424242
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const r = await adapter.fetchByUrls(creds, ['https://shopee.com.br/x-i.1.424242']);
    expect(r).toEqual([]);
  });
  it('toAffiliateLink usa generateShortLink', async () => {
    const f = fakeFetch([short]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    expect(await adapter.toAffiliateLink(creds, 'https://shopee.com.br/product/1/2', 's1')).toBe(
      'https://s.shopee.com.br/MOCK123',
    );
  });
  it('erro GraphQL vira status legível', async () => {
    const f = fakeFetch([{ errors: [{ message: 'invalid signature' }] }]);
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    await expect(adapter.checkConnection(creds)).resolves.toEqual({ ok: false, error: 'invalid signature' });
  });
  it('erro HTTP não-2xx inclui a mensagem GraphQL do corpo', async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ message: 'invalid app id' }] }), { status: 400 }),
    );
    const adapter = createShopeeAdapter({ fetchImpl: f as unknown as typeof fetch });
    await expect(adapter.checkConnection(creds)).resolves.toEqual({
      ok: false,
      error: 'HTTP 400: invalid app id',
    });
  });
});
