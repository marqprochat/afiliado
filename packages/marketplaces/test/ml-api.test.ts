import { describe, expect, it, vi } from 'vitest';
import {
  MlApiError,
  extractMlCatalogRef,
  fetchCatalogProduct,
  fetchProductOffers,
  mapMlCatalogProduct,
  searchCatalogProducts,
  type MlCatalogProduct,
  type MlOffer,
} from '../src/mercadolivre/api';

function fetchSequence(...responses: { status: number; body?: unknown }[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    };
  }) as unknown as typeof fetch;
}

const noSleep = vi.fn(async () => {});

describe('extractMlCatalogRef', () => {
  it('lê o ID do produto de catálogo de /p/MLB…', () => {
    expect(extractMlCatalogRef('https://www.mercadolivre.com.br/p/MLB62010143')).toEqual({
      productId: 'MLB62010143',
    });
  });

  it('lê o ID de URLs com slug antes do /p/ e sufixos depois', () => {
    expect(
      extractMlCatalogRef(
        'https://www.mercadolivre.com.br/fone-bluetooth-i12-preto/p/MLB22239330/s?_csrf=abc',
      ),
    ).toEqual({ productId: 'MLB22239330' });
  });

  it('lê o wid (ID da oferta) da query string', () => {
    expect(
      extractMlCatalogRef('https://www.mercadolivre.com.br/p/MLB62010143?wid=MLB3790915517'),
    ).toEqual({ productId: 'MLB62010143', offerId: 'MLB3790915517' });
  });

  it('lê o wid do fragmento (formato dos cards de busca)', () => {
    expect(
      extractMlCatalogRef(
        'https://www.mercadolivre.com.br/x/p/MLB62010143#polycard_client=search-nordic&wid=MLB3790915517&sid=search',
      ),
    ).toEqual({ productId: 'MLB62010143', offerId: 'MLB3790915517' });
  });

  it('normaliza o wid com hífen', () => {
    expect(
      extractMlCatalogRef('https://www.mercadolivre.com.br/p/MLB62010143?wid=MLB-3790915517'),
    ).toEqual({ productId: 'MLB62010143', offerId: 'MLB3790915517' });
  });

  it('devolve undefined para anúncio individual, listagem e outros domínios', () => {
    expect(extractMlCatalogRef('https://produto.mercadolivre.com.br/MLB-3790915517-fone-_JM')).toBeUndefined();
    expect(extractMlCatalogRef('https://lista.mercadolivre.com.br/fone-bluetooth')).toBeUndefined();
    expect(extractMlCatalogRef('https://www.amazon.com.br/dp/B08N5WRWNW')).toBeUndefined();
    expect(extractMlCatalogRef('não é url')).toBeUndefined();
  });
});

describe('chamadas à API', () => {
  it('envia o access token no header Authorization', async () => {
    const fetchImpl = fetchSequence({ status: 200, body: { id: 'MLB1', name: 'X' } });
    await fetchCatalogProduct('MLB1', 'tok-1', { fetchImpl, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/products/MLB1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer tok-1' }),
      }),
    );
  });

  it('401 e 403 viram ML_API_UNAUTHORIZED', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = fetchSequence({ status, body: { message: 'forbidden' } });
      await expect(
        fetchCatalogProduct('MLB1', 't', { fetchImpl, sleep: noSleep }),
      ).rejects.toMatchObject({ code: 'ML_API_UNAUTHORIZED' });
    }
  });

  it('404 vira ML_API_NOT_FOUND no produto', async () => {
    const fetchImpl = fetchSequence({ status: 404, body: { message: 'not found' } });
    await expect(fetchCatalogProduct('MLB1', 't', { fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      code: 'ML_API_NOT_FOUND',
    });
  });

  it('429 repete com backoff exponencial e depois consegue', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchImpl = fetchSequence(
      { status: 429 },
      { status: 429 },
      { status: 200, body: { id: 'MLB1', name: 'X' } },
    );
    const product = await fetchCatalogProduct('MLB1', 't', { fetchImpl, sleep });
    expect(product.id).toBe('MLB1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('429 persistente desiste depois de 3 novas tentativas com ML_API_RATE_LIMITED', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchImpl = fetchSequence({ status: 429 });
    await expect(fetchCatalogProduct('MLB1', 't', { fetchImpl, sleep })).rejects.toMatchObject({
      code: 'ML_API_RATE_LIMITED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it('5xx repete uma vez; se persistir vira ML_API_ERROR', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchImpl = fetchSequence({ status: 502 });
    await expect(fetchCatalogProduct('MLB1', 't', { fetchImpl, sleep })).rejects.toBeInstanceOf(MlApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ofertas: 404 "No winners found" vira lista vazia', async () => {
    const fetchImpl = fetchSequence({ status: 404, body: { message: 'No winners found' } });
    await expect(fetchProductOffers('MLB1', 't', { fetchImpl, sleep: noSleep })).resolves.toEqual([]);
  });

  it('ofertas: devolve results na ordem da API', async () => {
    const fetchImpl = fetchSequence({
      status: 200,
      body: { results: [{ item_id: 'A', price: 44.55 }, { item_id: 'B', price: 27 }] },
    });
    const offers = await fetchProductOffers('MLB1', 't', { fetchImpl, sleep: noSleep });
    expect(offers.map((o) => o.item_id)).toEqual(['A', 'B']);
  });

  it('busca monta a query de catálogo ativo do site MLB', async () => {
    const fetchImpl = fetchSequence({ status: 200, body: { results: [{ id: 'MLB1', name: 'Fone' }] } });
    const found = await searchCatalogProducts('fone bluetooth', 't', { fetchImpl, sleep: noSleep, limit: 15 });
    expect(found).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/products/search?status=active&site_id=MLB&q=fone%20bluetooth&limit=15',
      expect.anything(),
    );
  });
});

describe('mapMlCatalogProduct', () => {
  const product: MlCatalogProduct = {
    id: 'MLB62010143',
    name: 'Fone Bluetooth Redmi',
    pictures: [
      { url: 'https://http2.mlstatic.com/D_1.jpg' },
      { secure_url: 'https://http2.mlstatic.com/D_2.jpg' },
      { url: '' },
    ],
  };
  const offers: MlOffer[] = [
    { item_id: 'MLB111', price: 44.55, condition: 'new', seller_id: 1 },
    { item_id: 'MLB222', price: 27, condition: 'new', seller_id: 2 },
  ];
  const url = 'https://www.mercadolivre.com.br/p/MLB62010143';

  it('usa a primeira oferta (a principal da página), não a mais barata', () => {
    const p = mapMlCatalogProduct(product, offers, url);
    expect(p).toMatchObject({
      source: 'MERCADOLIVRE',
      externalId: 'MLB62010143',
      title: 'Fone Bluetooth Redmi',
      price: 44.55,
      originalUrl: url,
    });
    expect(p?.raw).toMatchObject({ source: 'ml-api', offerId: 'MLB111', offers: 2, sellerId: 1 });
  });

  it('usa a oferta do wid quando informado', () => {
    const p = mapMlCatalogProduct(product, offers, url, 'MLB222');
    expect(p?.price).toBe(27);
    expect(p?.raw).toMatchObject({ offerId: 'MLB222' });
  });

  it('wid que não está nas ofertas cai na regra padrão', () => {
    expect(mapMlCatalogProduct(product, offers, url, 'MLB999')?.price).toBe(44.55);
  });

  it('prefere a primeira oferta nova a uma usada que vem antes', () => {
    const mixed: MlOffer[] = [
      { item_id: 'U', price: 10, condition: 'used' },
      { item_id: 'N', price: 20, condition: 'new' },
    ];
    expect(mapMlCatalogProduct(product, mixed, url)?.price).toBe(20);
  });

  it('sem nenhuma oferta nova, usa a primeira oferta', () => {
    const used: MlOffer[] = [{ item_id: 'U', price: 10, condition: 'used' }];
    expect(mapMlCatalogProduct(product, used, url)?.price).toBe(10);
  });

  it('sem ofertas (produto indisponível) devolve undefined', () => {
    expect(mapMlCatalogProduct(product, [], url)).toBeUndefined();
  });

  it('preço inválido devolve undefined', () => {
    expect(mapMlCatalogProduct(product, [{ item_id: 'X', price: 0 }], url)).toBeUndefined();
    expect(mapMlCatalogProduct(product, [{ item_id: 'X', price: Number.NaN }], url)).toBeUndefined();
  });

  it('sem título devolve undefined', () => {
    expect(mapMlCatalogProduct({ id: 'MLB1' }, offers, url)).toBeUndefined();
  });

  it('junta imagens de url e secure_url e ignora vazias', () => {
    expect(mapMlCatalogProduct(product, offers, url)?.images).toEqual([
      'https://http2.mlstatic.com/D_1.jpg',
      'https://http2.mlstatic.com/D_2.jpg',
    ]);
  });

  it('não preenche preço original nem desconto (a API não os fornece)', () => {
    const p = mapMlCatalogProduct(product, offers, url);
    expect(p).not.toHaveProperty('originalPrice');
    expect(p).not.toHaveProperty('discountPct');
  });

  it('inventory_id preenchido indica Full; ausente fica UNKNOWN', () => {
    const full = mapMlCatalogProduct(product, [{ item_id: 'F', price: 30, condition: 'new', inventory_id: 'ABC123' }], url);
    const other = mapMlCatalogProduct(product, [{ item_id: 'O', price: 30, condition: 'new', inventory_id: null }], url);
    expect(full?.shipping).toBe('FULL');
    expect(other?.shipping).toBe('UNKNOWN');
  });
});
