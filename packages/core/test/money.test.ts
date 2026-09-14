import { describe, it, expect } from 'vitest';
import { formatBRL, discountLabel } from '../src/money';

describe('formatBRL', () => {
  it('formata com separador de milhar e vírgula', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(99.9)).toBe('R$ 99,90');
  });
});

describe('discountLabel', () => {
  it('gera -NN% OFF', () => {
    expect(discountLabel(25)).toBe('-25% OFF');
  });
  it('vazio quando não há desconto', () => {
    expect(discountLabel(undefined)).toBe('');
    expect(discountLabel(0)).toBe('');
  });
});
