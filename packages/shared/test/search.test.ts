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
});
