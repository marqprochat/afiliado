import { describe, it, expect } from 'vitest';
import fixture from '../src/shopee/fixtures/productOfferV2.json';
import { mapProductOffer } from '../src/shopee/mapper';

const nodes = fixture.data.productOfferV2.nodes;

describe('mapProductOffer', () => {
  it('mapeia campos principais', () => {
    const p = mapProductOffer(nodes[0]!);
    expect(p).toMatchObject({
      source: 'SHOPEE',
      externalId: '987654',
      shopId: '123456',
      title: 'Processador AMD Ryzen 5 5500',
      price: 848.48,
      discountPct: 29,
      salesCount: 6,
      commissionPct: 3,
      images: ['https://cf.shopee.com.br/file/abc'],
      originalUrl: 'https://shopee.com.br/product/123456/987654',
      shopName: 'Loja Oficial AMD',
    });
    expect(p.originalPrice).toBeCloseTo(1194.99, 1);
    expect(p.flashSaleEndsAt).toBeUndefined();
  });
  it('sem desconto → sem originalPrice; periodEndTime vira flashSaleEndsAt', () => {
    const p = mapProductOffer(nodes[1]!);
    expect(p.originalPrice).toBeUndefined();
    expect(p.discountPct).toBeUndefined();
    expect(p.flashSaleEndsAt).toBe(new Date(1789000000 * 1000).toISOString());
  });
});
