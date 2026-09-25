import { describe, it, expect } from 'vitest';
import { searchQuerySchema } from '../src/search';

describe('searchQuerySchema', () => {
  it('aplica defaults', () => {
    const q = searchQuerySchema.parse({ source: 'SHOPEE', mode: 'keyword', query: 'ryzen' });
    expect(q).toEqual({
      source: 'SHOPEE',
      mode: 'keyword',
      query: 'ryzen',
      sort: 'DISCOUNT_DESC',
      limit: 100,
      topSellers: false,
      extraCommission: false,
      freeShippingOnly: false,
    });
  });

  it('exige query no modo keyword', () => {
    expect(() => searchQuerySchema.parse({ source: 'SHOPEE', mode: 'keyword' })).toThrow();
  });

  it('exige shopId no modo shop', () => {
    expect(() => searchQuerySchema.parse({ source: 'SHOPEE', mode: 'shop' })).toThrow();
  });

  it('limita limit a 500', () => {
    expect(() =>
      searchQuerySchema.parse({ source: 'SHOPEE', mode: 'trending', limit: 501 }),
    ).toThrow();
  });

  it('rejeita minPrice maior que maxPrice', () => {
    expect(() =>
      searchQuerySchema.parse({
        source: 'SHOPEE',
        mode: 'trending',
        minPrice: 100,
        maxPrice: 50,
      }),
    ).toThrow();
  });

  it('aceita filtros de preço/desconto/vendas/frete', () => {
    const q = searchQuerySchema.parse({
      source: 'SHOPEE',
      mode: 'trending',
      minPrice: 10,
      maxPrice: 200,
      minDiscountPct: 20,
      minSales: 5,
      freeShippingOnly: true,
    });
    expect(q.minPrice).toBe(10);
    expect(q.maxPrice).toBe(200);
    expect(q.minDiscountPct).toBe(20);
    expect(q.minSales).toBe(5);
    expect(q.freeShippingOnly).toBe(true);
  });
});
