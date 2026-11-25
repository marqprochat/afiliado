import { describe, it, expect } from 'vitest';
import { marketplaceUpdateSchema } from '../src/api';

describe('marketplaceUpdateSchema: token da Awin', () => {
  it('aceita PAT longo e remove espaços das pontas', () => {
    const long = 'a'.repeat(1200);
    expect(marketplaceUpdateSchema.parse({ offersApiToken: `  ${long}\n` }).offersApiToken).toBe(
      long,
    );
    expect(() => marketplaceUpdateSchema.parse({ offersApiToken: 'a'.repeat(4097) })).toThrow();
  });
  it('aceita validade YYYY-MM-DD e string vazia; rejeita outros formatos', () => {
    expect(
      marketplaceUpdateSchema.parse({ offersApiTokenExpiresAt: '2027-03-10' })
        .offersApiTokenExpiresAt,
    ).toBe('2027-03-10');
    expect(
      marketplaceUpdateSchema.parse({ offersApiTokenExpiresAt: '' }).offersApiTokenExpiresAt,
    ).toBe('');
    expect(() =>
      marketplaceUpdateSchema.parse({ offersApiTokenExpiresAt: '10/03/2027' }),
    ).toThrow();
    expect(() => marketplaceUpdateSchema.parse({ offersApiTokenExpiresAt: '2027-3-1' })).toThrow();
  });
});
