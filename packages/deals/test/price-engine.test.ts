import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import type { ProductData } from '@afilados/shared';
import { indexProductInPriceEngine } from '../src/index';

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
