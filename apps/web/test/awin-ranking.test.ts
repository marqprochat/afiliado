import { describe, it, expect } from 'vitest';
import { awinStoreLabel, formatEpc, sortByStoreRank } from '@/lib/awin-ranking';

describe('formatEpc', () => {
  it('formata na moeda do programa (padrão BRL), com espaço comum', () => {
    expect(formatEpc(0.42, 'BRL')).toBe('R$ 0,42');
    expect(formatEpc(1.5, null)).toBe('R$ 1,50');
    expect(formatEpc(null, 'BRL')).toBe('—');
  });
});

describe('awinStoreLabel', () => {
  it('nome · EPC quando há indicador; só o nome quando não há', () => {
    expect(awinStoreLabel({ name: 'Drogal BR', epc: 0.42, currency: 'BRL' })).toBe(
      'Drogal BR · EPC R$ 0,42',
    );
    expect(awinStoreLabel({ name: 'Avulsa', epc: null, currency: null })).toBe('Avulsa');
  });
});

describe('sortByStoreRank', () => {
  it('ordena pela posição da loja no ranking e mantém a ordem dentro da loja', () => {
    const products = [
      { id: '1', shopName: 'B' },
      { id: '2', shopName: 'Sem ranking' },
      { id: '3', shopName: 'A' },
      { id: '4', shopName: 'B' },
      { id: '5', shopName: null },
      { id: '6', shopName: 'a' },
    ];
    expect(sortByStoreRank(products, ['A', 'B']).map((p) => p.id)).toEqual([
      '3',
      '6',
      '1',
      '4',
      '2',
      '5',
    ]);
  });
});
