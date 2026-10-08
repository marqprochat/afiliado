import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../src';

const base = { source: 'AMAZON', mode: 'listing' } as const;

describe('searchQuerySchema: listagem da Amazon', () => {
  it('ofertas por palavra-chave exigem a query', () => {
    expect(() => searchQuerySchema.parse({ ...base, amazonListing: { kind: 'deals' } })).toThrow();
    const ok = searchQuerySchema.parse({
      ...base,
      amazonListing: { kind: 'deals' },
      query: 'celular',
    });
    expect(ok.amazonListing).toEqual({ kind: 'deals' });
    expect(ok.query).toBe('celular');
  });

  it('a Mega Oferta Prime não exige query (ela só filtra por título)', () => {
    const ok = searchQuerySchema.parse({ ...base, amazonListing: { kind: 'mega' } });
    expect(ok.amazonListing?.kind).toBe('mega');
    expect(
      searchQuerySchema.parse({ ...base, amazonListing: { kind: 'mega' }, query: 'fone' }).query,
    ).toBe('fone');
  });

  it('exige amazonListing no modo listing e rejeita tipos desconhecidos', () => {
    expect(() => searchQuerySchema.parse({ ...base, query: 'celular' })).toThrow();
    expect(() =>
      searchQuerySchema.parse({ ...base, amazonListing: { kind: 'bestsellers' }, query: 'x' }),
    ).toThrow();
  });

  it('o ML continua exigindo mlListing, e Shopee/Magalu/Awin/AliExpress não têm listagem', () => {
    expect(() =>
      searchQuerySchema.parse({
        source: 'MERCADOLIVRE',
        mode: 'listing',
        amazonListing: { kind: 'mega' },
      }),
    ).toThrow();
    for (const source of ['SHOPEE', 'MAGALU', 'AWIN', 'ALIEXPRESS'] as const) {
      expect(() =>
        searchQuerySchema.parse({
          source,
          mode: 'listing',
          amazonListing: { kind: 'mega' },
          mlListing: { kind: 'deals' },
        }),
      ).toThrow();
    }
  });
});
