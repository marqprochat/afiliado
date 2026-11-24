import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import type { ProductData } from '@afilados/shared';
import { indexProductInPriceEngine, getDealsShowcase } from '../src/index';

let tenantId: string;

const fone: ProductData = {
  source: 'SHOPEE',
  externalId: 'pe-1',
  title: 'Fone Bluetooth Motor Preco Teste',
  price: 100,
  images: ['https://img.test/fone.jpg'],
  shipping: 'UNKNOWN',
  originalUrl: 'https://shopee.com.br/product/1/111',
  raw: {},
};

const listingOf = (externalId: string) =>
  prisma.productListing.findFirstOrThrow({ where: { tenantId, source: 'SHOPEE', externalId } });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'deals-engine' } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('indexProductInPriceEngine', () => {
  let firstSlug: string;

  it('grava o link de afiliado informado e devolve o slug do produto canônico', async () => {
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, fone, {
      affiliateUrl: 'https://s.shopee.com.br/AFF1',
    });
    const master = await prisma.masterProduct.findFirstOrThrow({
      where: { id: r.masterProductId },
    });
    expect(r.slug).toBe(master.slug);
    expect((await listingOf('pe-1')).affiliateUrl).toBe('https://s.shopee.com.br/AFF1');
    firstSlug = r.slug;
  });

  it('sem link novo, preserva o link gravado e devolve o slug do canônico existente', async () => {
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, {
      ...fone,
      price: 90,
    });
    const listing = await listingOf('pe-1');
    expect(listing.affiliateUrl).toBe('https://s.shopee.com.br/AFF1');
    expect(Number(listing.currentPrice)).toBe(90);
    expect(r.slug).toBe(firstSlug);
  });

  it('com link novo, substitui o link gravado', async () => {
    await indexProductInPriceEngine(forTenant(tenantId), tenantId, fone, {
      affiliateUrl: 'https://s.shopee.com.br/AFF2',
    });
    expect((await listingOf('pe-1')).affiliateUrl).toBe('https://s.shopee.com.br/AFF2');
  });

  it('listagem nova sem link convertido usa o originalUrl', async () => {
    const panela: ProductData = {
      ...fone,
      externalId: 'pe-2',
      title: 'Panela Eletrica Arroz Totalmente Diferente',
      originalUrl: 'https://shopee.com.br/product/1/222',
    };
    const r = await indexProductInPriceEngine(forTenant(tenantId), tenantId, panela);
    expect((await listingOf('pe-2')).affiliateUrl).toBe(panela.originalUrl);
    expect(r.slug.length).toBeGreaterThan(0);
  });
});

describe('indexProductInPriceEngine: listagem presa a produto incompatível', () => {
  const pro: ProductData = {
    ...fone,
    externalId: 'ip-pro',
    title: 'Apple iPhone 17 Pro 256 GB - azul intenso',
    price: 9000,
    originalUrl: 'https://shopee.com.br/product/1/901',
  };
  const base: ProductData = {
    ...fone,
    externalId: 'ip-base',
    title: 'Apple iPhone 17 256 GB - azul intenso',
    price: 3000,
    originalUrl: 'https://shopee.com.br/product/1/902',
  };

  it('move a listagem para outro produto, preserva o histórico e recalcula os dois', async () => {
    const db = forTenant(tenantId);
    const rPro = await indexProductInPriceEngine(db, tenantId, pro);

    // Estado poluído (como em produção): a listagem do iPhone 17 está presa ao 17 Pro.
    const stuck = await prisma.productListing.create({
      data: {
        tenantId,
        masterProductId: rPro.masterProductId,
        source: 'SHOPEE',
        storeName: 'Shopee',
        externalId: 'ip-base',
        title: base.title,
        originalUrl: base.originalUrl,
        affiliateUrl: 'https://s.shopee.com.br/BASE',
        currentPrice: 3200,
        history: { create: [{ price: 3500 }, { price: 3200 }] },
      },
    });
    await prisma.masterProduct.update({
      where: { id: rPro.masterProductId },
      data: { currentBestPrice: 3200, lowestPriceEver: 3200, listingsCount: 2 },
    });

    const r = await indexProductInPriceEngine(db, tenantId, base);

    expect(r.masterProductId).not.toBe(rPro.masterProductId);
    expect(r.isNewMaster).toBe(true);
    const moved = await listingOf('ip-base');
    expect(moved.id).toBe(stuck.id);
    expect(moved.masterProductId).toBe(r.masterProductId);
    expect(moved.affiliateUrl).toBe('https://s.shopee.com.br/BASE');
    const history = await prisma.priceHistory.findMany({ where: { listingId: stuck.id } });
    expect(history.map((h) => Number(h.price)).sort()).toEqual([3000, 3200, 3500]);

    const oldMaster = await prisma.masterProduct.findUniqueOrThrow({
      where: { id: rPro.masterProductId },
    });
    expect(Number(oldMaster.currentBestPrice)).toBe(9000);
    expect(Number(oldMaster.lowestPriceEver)).toBe(9000);
    expect(oldMaster.listingsCount).toBe(1);

    const newMaster = await prisma.masterProduct.findUniqueOrThrow({
      where: { id: r.masterProductId },
    });
    expect(newMaster.slug).toBe(r.slug);
    expect(Number(newMaster.currentBestPrice)).toBe(3000);
    expect(Number(newMaster.lowestPriceEver)).toBe(3000);
    expect(newMaster.listingsCount).toBe(1);
    expect(newMaster.bestListingId).toBe(stuck.id);
  });

  it('listagem compatível continua no mesmo produto', async () => {
    const db = forTenant(tenantId);
    const before = await listingOf('ip-pro');
    const r = await indexProductInPriceEngine(db, tenantId, { ...pro, price: 8800 });
    expect(r.masterProductId).toBe(before.masterProductId);
    expect(r.isNewMaster).toBe(false);
  });

  it('produto antigo sem listagens fica com listingsCount 0', async () => {
    const db = forTenant(tenantId);
    const solo: ProductData = {
      ...fone,
      externalId: 'tv-solo',
      title: 'Smart TV 55 Samsung Crystal UHD 4K',
      price: 2999,
      originalUrl: 'https://shopee.com.br/product/1/903',
    };
    const first = await indexProductInPriceEngine(db, tenantId, solo);
    // O vendedor trocou o anúncio para a TV de 50": a listagem sai do produto de 55".
    const r = await indexProductInPriceEngine(db, tenantId, {
      ...solo,
      title: 'Smart TV 50 Samsung Crystal UHD 4K',
      price: 2599,
    });
    expect(r.masterProductId).not.toBe(first.masterProductId);
    const orphan = await prisma.masterProduct.findUniqueOrThrow({
      where: { id: first.masterProductId },
    });
    expect(orphan.listingsCount).toBe(0);
    expect(orphan.bestListingId).toBeNull();
    const showcase = await getDealsShowcase(db, { limit: 50 });
    expect(showcase.deals.map((d) => d.id)).not.toContain(first.masterProductId);
    expect(showcase.deals.map((d) => d.id)).toContain(r.masterProductId);
  });
});

describe('indexProductInPriceEngine: título com "+" e aspas (regressão: página nova a cada envio)', () => {
  const s24plus: ProductData = {
    ...fone,
    externalId: 's24-plus',
    title: 'Samsung Galaxy S24+ 256GB Preto',
    price: 4500,
    originalUrl: 'https://shopee.com.br/product/1/904',
  };

  it('reindexar o mesmo S24+ mantém o produto e o slug', async () => {
    const db = forTenant(tenantId);
    const first = await indexProductInPriceEngine(db, tenantId, s24plus);
    const again = await indexProductInPriceEngine(db, tenantId, { ...s24plus, price: 4400 });
    const third = await indexProductInPriceEngine(db, tenantId, { ...s24plus, price: 4300 });
    expect(again.masterProductId).toBe(first.masterProductId);
    expect(third.masterProductId).toBe(first.masterProductId);
    expect(again.slug).toBe(first.slug);
    expect(third.slug).toBe(first.slug);
    expect(again.isNewMaster).toBe(false);
  });

  it('TV com polegadas entre aspas também mantém o produto', async () => {
    const db = forTenant(tenantId);
    const tv: ProductData = {
      ...fone,
      externalId: 'tv-aspas',
      title: 'Smart TV LG 55" 4K UHD ThinQ AI 55UR8750PSA',
      price: 2800,
      originalUrl: 'https://shopee.com.br/product/1/905',
    };
    const first = await indexProductInPriceEngine(db, tenantId, tv);
    const again = await indexProductInPriceEngine(db, tenantId, { ...tv, price: 2700 });
    expect(again.masterProductId).toBe(first.masterProductId);
    expect(again.slug).toBe(first.slug);
  });

  it('listagem S24+ presa a página antiga (título gravado sem o "+") não é movida', async () => {
    const db = forTenant(tenantId);
    const legacy = await prisma.masterProduct.create({
      data: {
        tenantId,
        title: 'Samsung Galaxy S24 512GB preto',
        cleanTitle: 'Samsung Galaxy S24 512GB preto',
        slug: 'samsung-galaxy-s24-512gb-preto-old1',
        brand: 'Samsung',
        lowestPriceEver: 5200,
        averagePrice30d: 5200,
        currentBestPrice: 5200,
        listingsCount: 1,
      },
    });
    await prisma.productListing.create({
      data: {
        tenantId,
        masterProductId: legacy.id,
        source: 'SHOPEE',
        storeName: 'Shopee',
        externalId: 's24-plus-legacy',
        title: 'Samsung Galaxy S24+ 512GB Preto',
        originalUrl: 'https://shopee.com.br/product/1/906',
        affiliateUrl: 'https://s.shopee.com.br/LEG',
        currentPrice: 5200,
      },
    });
    const r = await indexProductInPriceEngine(db, tenantId, {
      ...s24plus,
      externalId: 's24-plus-legacy',
      title: 'Samsung Galaxy S24+ 512GB Preto',
      price: 5100,
      originalUrl: 'https://shopee.com.br/product/1/906',
    });
    expect(r.masterProductId).toBe(legacy.id);
    expect(r.slug).toBe('samsung-galaxy-s24-512gb-preto-old1');
  });
});
