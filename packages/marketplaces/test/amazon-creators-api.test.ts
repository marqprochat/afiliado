import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonApiError, getAccessToken, resetAmazonApiState } from '../src/amazon/creators-api';

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('getAccessToken', () => {
  beforeEach(() => {
    resetAmazonApiState();
  });

  it('faz POST no endpoint de token com client_credentials e devolve o access_token', async () => {
    const fetchImpl = fetchReturning(200, {
      access_token: 'tok-123',
      token_type: 'bearer',
      expires_in: 3600,
    });
    const token = await getAccessToken(
      { clientId: 'cid', clientSecret: 'csecret' },
      { fetchImpl, tokenEndpoint: 'https://api.amazon.com/auth/o2/token' },
    );
    expect(token).toBe('tok-123');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: 'cid',
          client_secret: 'csecret',
          scope: 'creatorsapi::default',
        }),
      }),
    );
  });

  it('cacheia o token e não faz nova chamada enquanto ele não expirar', async () => {
    const fetchImpl = fetchReturning(200, { access_token: 'tok-abc', expires_in: 3600 });
    const creds = { clientId: 'cid2', clientSecret: 'csecret2' };
    await getAccessToken(creds, { fetchImpl });
    await getAccessToken(creds, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lança AmazonApiError(AMAZON_API_UNAUTHORIZED) em 401', async () => {
    const fetchImpl = fetchReturning(401, { error: 'invalid_client' });
    await expect(
      getAccessToken({ clientId: 'bad', clientSecret: 'bad' }, { fetchImpl }),
    ).rejects.toThrow(AmazonApiError);
    try {
      await getAccessToken({ clientId: 'bad2', clientSecret: 'bad2' }, { fetchImpl });
    } catch (err) {
      expect((err as AmazonApiError).code).toBe('AMAZON_API_UNAUTHORIZED');
    }
  });

  it('lança AmazonApiError(AMAZON_API_ERROR) em outros erros HTTP', async () => {
    const fetchImpl = fetchReturning(500, {});
    await expect(
      getAccessToken({ clientId: 'x', clientSecret: 'y' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'AMAZON_API_ERROR' });
  });
});

import { extractAsin, getItems, mapCreatorsApiItem, type AmazonApiItem } from '../src/amazon/creators-api';

describe('extractAsin', () => {
  it('extrai o ASIN de /dp/, /gp/product/ e /product/', () => {
    expect(extractAsin('https://www.amazon.com.br/dp/B09B8V1LZ3')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/gp/product/B09B8V1LZ3/ref=x')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/algo/product/B09B8V1LZ3')).toBe('B09B8V1LZ3');
    expect(extractAsin('https://www.amazon.com.br/busca?q=teste')).toBeUndefined();
  });
});

describe('getItems', () => {
  beforeEach(() => {
    resetAmazonApiState();
  });

  const creds = { clientId: 'cid', clientSecret: 'csecret', partnerTag: 'minha-20' };

  it('faz POST em <baseUrl>/catalog/v1/getItems com itemIds, partnerTag e resources', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemResults: { items: [{ asin: 'B09B8V1LZ3' }] } }),
      };
    }) as unknown as typeof fetch;

    const items = await getItems(['B09B8V1LZ3'], creds, {
      fetchImpl,
      baseUrl: 'https://creatorsapi.amazon',
    });

    expect(items).toEqual([{ asin: 'B09B8V1LZ3' }]);
    const getItemsCall = calls.find((c) => c.url.includes('/catalog/v1/getItems'))!;
    expect(getItemsCall.url).toBe('https://creatorsapi.amazon/catalog/v1/getItems');
    const body = JSON.parse(getItemsCall.init.body as string);
    expect(body).toMatchObject({
      itemIds: ['B09B8V1LZ3'],
      itemIdType: 'ASIN',
      partnerTag: 'minha-20',
      marketplace: 'www.amazon.com.br',
    });
    expect(body.resources).toEqual(
      expect.arrayContaining(['itemInfo.title', 'images.primary.large', 'offersV2.listings.price', 'parentASIN']),
    );
    expect(getItemsCall.init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('divide mais de 10 ASINs em lotes de até 10', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      bodies.push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({ itemResults: { items: [] } }) };
    }) as unknown as typeof fetch;

    const asins = Array.from({ length: 12 }, (_, i) => `ASIN${String(i).padStart(6, '0')}`);
    await getItems(asins, creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' });

    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { itemIds: string[] }).itemIds).toHaveLength(10);
    expect((bodies[1] as { itemIds: string[] }).itemIds).toHaveLength(2);
  });

  it('lança AmazonApiError(AMAZON_API_RATE_LIMITED) em 429', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: false, status: 429, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await expect(
      getItems(['B09B8V1LZ3'], creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' }),
    ).rejects.toMatchObject({ code: 'AMAZON_API_RATE_LIMITED' });
  });

  it('serializa chamadas concorrentes do mesmo clientId: a 2ª só bate na API >= 1s depois da 1ª', async () => {
    const getItemsCallTimes: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/o2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      getItemsCallTimes.push(Date.now());
      return { ok: true, status: 200, json: async () => ({ itemResults: { items: [] } }) };
    }) as unknown as typeof fetch;

    await Promise.all([
      getItems(['AAAAAAAAAA'], creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' }),
      getItems(['BBBBBBBBBB'], creds, { fetchImpl, baseUrl: 'https://creatorsapi.amazon' }),
    ]);

    expect(getItemsCallTimes).toHaveLength(2);
    const gap = getItemsCallTimes[1]! - getItemsCallTimes[0]!;
    expect(gap).toBeGreaterThanOrEqual(900);
  }, 10_000);
});

describe('mapCreatorsApiItem', () => {
  it('mapeia título, imagem, preço e desconto quando presentes', () => {
    const item: AmazonApiItem = {
      asin: 'B09B8V1LZ3',
      itemInfo: { title: { displayValue: 'Echo Dot 5ª Geração' } },
      images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/x.jpg' } } },
      offersV2: {
        listings: [
          { price: { money: { amount: 299, currency: 'BRL' }, savings: { percentage: 30, money: { amount: 130 } } } },
        ],
      },
    };
    const product = mapCreatorsApiItem(item, 'https://www.amazon.com.br/dp/B09B8V1LZ3');
    expect(product.source).toBe('AMAZON');
    expect(product.externalId).toBe('B09B8V1LZ3');
    expect(product.title).toBe('Echo Dot 5ª Geração');
    expect(product.price).toBe(299);
    expect(product.originalPrice).toBe(429);
    expect(product.discountPct).toBe(30);
    expect(product.images).toEqual(['https://m.media-amazon.com/images/I/x.jpg']);
    expect(product.originalUrl).toBe('https://www.amazon.com.br/dp/B09B8V1LZ3');
  });

  it('não lança erro e usa defaults quando faltam preço/imagem', () => {
    const item: AmazonApiItem = { asin: 'B0X', itemInfo: { title: { displayValue: 'Sem preço' } } };
    const product = mapCreatorsApiItem(item, 'https://www.amazon.com.br/dp/B0X');
    expect(product.price).toBe(0);
    expect(product.images).toEqual([]);
    expect(product.originalPrice).toBeUndefined();
    expect(product.discountPct).toBeUndefined();
  });
});
