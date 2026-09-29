import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductData } from '@afilados/shared';

vi.mock('../src/scrapers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/scrapers')>();
  return { ...original, scrapeMercadoLivre: vi.fn() };
});

import { scrapeMercadoLivre } from '../src/scrapers';
import { createTagAdapter } from '../src/tag-adapter';

const scrape = vi.mocked(scrapeMercadoLivre);

function product(id: string, url: string, price = 44.55): ProductData {
  return {
    source: 'MERCADOLIVRE',
    externalId: id,
    title: `Produto ${id}`,
    price,
    images: [],
    shipping: 'UNKNOWN',
    originalUrl: url,
    raw: {},
  };
}

const withApi = { mlApi: { refreshToken: 'ref-1', accessToken: 'tok-1' } };
const CATALOG = 'https://www.mercadolivre.com.br/p/MLB62010143';
const ITEM = 'https://produto.mercadolivre.com.br/MLB-3790915517-fone-_JM';

describe('Mercado Livre por API oficial no tag adapter', () => {
  beforeEach(() => {
    scrape.mockReset();
    scrape.mockImplementation(async (url: string) => product('SCRAPED', url, 10));
  });

  it('link de catálogo usa a API com o access token e não raspa a página', async () => {
    const mlCatalogFetch = vi.fn(async (_ref, url: string) => product('MLB62010143', url));
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    const result = await a.fetchByUrls(withApi, [CATALOG]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ externalId: 'MLB62010143', price: 44.55 });
    expect(mlCatalogFetch).toHaveBeenCalledWith({ productId: 'MLB62010143' }, CATALOG, 'tok-1');
    expect(scrape).not.toHaveBeenCalled();
  });

  it('repassa o wid (oferta) da URL para a busca', async () => {
    const mlCatalogFetch = vi.fn(async (_ref, url: string) => product('MLB62010143', url));
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });
    const url = `${CATALOG}?wid=MLB3790915517`;

    await a.fetchByUrls(withApi, [url]);

    expect(mlCatalogFetch).toHaveBeenCalledWith(
      { productId: 'MLB62010143', offerId: 'MLB3790915517' },
      url,
      'tok-1',
    );
  });

  it('produto indisponível na API é descartado, sem cair na raspagem', async () => {
    const mlCatalogFetch = vi.fn(async () => undefined);
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    expect(await a.fetchByUrls(withApi, [CATALOG])).toEqual([]);
    expect(scrape).not.toHaveBeenCalled();
  });

  it('erro da API em uma URL não impede as outras', async () => {
    const mlCatalogFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ML_API_RATE_LIMITED'))
      .mockImplementationOnce(async (_ref, url: string) => product('MLB22239330', url));
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    const result = await a.fetchByUrls(withApi, [CATALOG, 'https://www.mercadolivre.com.br/p/MLB22239330']);

    expect(result.map((p) => p.externalId)).toEqual(['MLB22239330']);
  });

  it('anúncio individual (a API não resolve) mantém a raspagem atual', async () => {
    const mlCatalogFetch = vi.fn();
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    const result = await a.fetchByUrls(withApi, [ITEM]);

    expect(mlCatalogFetch).not.toHaveBeenCalled();
    expect(scrape).toHaveBeenCalledWith(ITEM);
    expect(result[0]).toMatchObject({ externalId: 'SCRAPED' });
  });

  it('sem mlApi conectada mantém a raspagem para qualquer URL', async () => {
    const mlCatalogFetch = vi.fn();
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    await a.fetchByUrls({}, [CATALOG]);

    expect(mlCatalogFetch).not.toHaveBeenCalled();
    expect(scrape).toHaveBeenCalledWith(CATALOG);
  });

  it('mlApi sem access token (renovação não feita) mantém a raspagem', async () => {
    const mlCatalogFetch = vi.fn();
    const a = createTagAdapter('MERCADOLIVRE', { mlCatalogFetch });

    await a.fetchByUrls({ mlApi: { refreshToken: 'ref-1' } }, [CATALOG]);

    expect(mlCatalogFetch).not.toHaveBeenCalled();
    expect(scrape).toHaveBeenCalledWith(CATALOG);
  });
});
