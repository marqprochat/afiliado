import { describe, it, expect, vi } from 'vitest';
import type { TenantClient } from '@afilados/db';
import type { indexProductInPriceEngine } from '@afilados/deals';
import type { ProductData } from '@afilados/shared';
import { publishOffer } from '../src/lib/publish-offer';

type IndexFn = typeof indexProductInPriceEngine;

const product: ProductData = {
  source: 'SHOPEE',
  externalId: '1',
  title: 'Fone',
  price: 99.9,
  images: [],
  shipping: 'UNKNOWN',
  originalUrl: 'https://shopee.com.br/product/1/1',
  raw: {},
};

const fakeDb = (value: unknown) =>
  ({
    setting: {
      findFirst: vi.fn(async () => (value === undefined ? null : { key: 'siteLinks', value })),
    },
  }) as unknown as TenantClient;

const owner = async () => true;

const indexOk = () =>
  vi.fn<IndexFn>(async () => ({
    masterProductId: 'm1',
    slug: 'fone-ab12',
    isNewMaster: true,
    isPriceDrop: false,
  }));

describe('publishOffer', () => {
  it('chave ausente → null, sem indexar', async () => {
    const index = indexOk();
    const r = await publishOffer(fakeDb(undefined), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBeNull();
    expect(index).not.toHaveBeenCalled();
  });

  it('chave desligada → null', async () => {
    const r = await publishOffer(fakeDb({ enabled: false }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index: indexOk(),
    });
    expect(r).toBeNull();
  });

  it('sem PUBLIC_SITE_URL → null', async () => {
    const index = indexOk();
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: undefined,
      index,
    });
    expect(r).toBeNull();
    expect(index).not.toHaveBeenCalled();
  });

  it('sucesso → URL da página no site, com o link de afiliado repassado ao motor', async () => {
    const index = indexOk();
    const db = fakeDb({ enabled: true });
    const r = await publishOffer(db, 't1', product, 'https://s.shopee.com.br/AFF', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test/',
      index,
    });
    expect(r).toBe('https://site.test/ofertas/fone-ab12');
    expect(index).toHaveBeenCalledWith(db, 't1', product, {
      affiliateUrl: 'https://s.shopee.com.br/AFF',
    });
  });

  it('chave ligada em tenant que não é do dono (raiz com superadmin) → null, sem indexar', async () => {
    const index = indexOk();
    const isOwnerTenant = vi.fn(async () => false);
    const r = await publishOffer(fakeDb({ enabled: true }), 't9', product, 'https://aff', {
      isOwnerTenant,
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBeNull();
    expect(isOwnerTenant).toHaveBeenCalledWith('t9');
    expect(index).not.toHaveBeenCalled();
  });

  it('exceção ao indexar → null', async () => {
    const index = vi.fn<IndexFn>(async () => {
      throw new Error('db fora');
    });
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBeNull();
  });

  it('conflito de unicidade (P2002) tenta indexar de novo uma vez', async () => {
    const index = vi
      .fn<IndexFn>()
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockResolvedValueOnce({
        masterProductId: 'm1',
        slug: 'fone-ab12',
        isNewMaster: false,
        isPriceDrop: false,
      });
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index,
    });
    expect(r).toBe('https://site.test/ofertas/fone-ab12');
    expect(index).toHaveBeenCalledTimes(2);
  });

  it('indexação acima do teto de tempo → null', async () => {
    const index = vi.fn<IndexFn>(() => new Promise(() => {}));
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      timeoutMs: 20,
      index,
    });
    expect(r).toBeNull();
  });

  it('AWIN com imagem fora do ar → indexa com a imagem substituta', async () => {
    const index = indexOk();
    const awin: ProductData = {
      ...product,
      source: 'AWIN',
      images: ['https://morta/a.jpg'],
      originalUrl: 'https://www.awin1.com/pclick.php?p=1',
    };
    const resolveImage = vi.fn(async () => ({
      url: 'https://drogal.vteximg.com.br/a.jpg',
      status: 'resolved' as const,
    }));
    await publishOffer(fakeDb({ enabled: true }), 't1', awin, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index,
      resolveImage,
    });
    expect(resolveImage).toHaveBeenCalledWith({
      imageUrl: 'https://morta/a.jpg',
      deepLink: 'https://www.awin1.com/pclick.php?p=1',
      title: 'Fone',
    });
    expect(index.mock.calls[0]![2].images).toEqual(['https://drogal.vteximg.com.br/a.jpg']);
  });

  it('AWIN: falha ou demora ao resolver a imagem não impede a publicação', async () => {
    const index = indexOk();
    const awin: ProductData = { ...product, source: 'AWIN', images: ['https://morta/a.jpg'] };
    const r = await publishOffer(fakeDb({ enabled: true }), 't1', awin, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index,
      imageBudgetMs: 20,
      resolveImage: () => new Promise(() => undefined),
    });
    expect(r).toBe('https://site.test/ofertas/fone-ab12');
    expect(index.mock.calls[0]![2].images).toEqual(['https://morta/a.jpg']);
  });

  it('outras fontes não consultam a imagem substituta', async () => {
    const resolveImage = vi.fn();
    await publishOffer(fakeDb({ enabled: true }), 't1', product, 'https://aff', {
      isOwnerTenant: owner,
      siteUrl: 'https://site.test',
      index: indexOk(),
      resolveImage,
    });
    expect(resolveImage).not.toHaveBeenCalled();
  });
});
