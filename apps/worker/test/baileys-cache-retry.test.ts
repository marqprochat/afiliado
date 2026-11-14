import { describe, it, expect, vi } from 'vitest';
import { MemoryCacheStore } from '../src/wa/baileys-gateway';

describe('MemoryCacheStore', () => {
  it('armazena e recupera valores', () => {
    const cache = new MemoryCacheStore(10, 60_000);
    cache.set('key1', 'valor1');
    expect(cache.get('key1')).toBe('valor1');
  });

  it('retorna undefined para chave inexistente ou deletada', () => {
    const cache = new MemoryCacheStore(10, 60_000);
    cache.set('key1', 'valor1');
    cache.del('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('limpa todos os valores com flushAll', () => {
    const cache = new MemoryCacheStore(10, 60_000);
    cache.set('k1', 1);
    cache.set('k2', 2);
    cache.flushAll();
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeUndefined();
  });

  it('respeita o limite maxEntries removendo a entrada mais antiga', () => {
    const cache = new MemoryCacheStore(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // deve despejar 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('expira itens com TTL', async () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCacheStore(10, 500);
      cache.set('temp', 'passou', 500);
      expect(cache.get('temp')).toBe('passou');

      vi.advanceTimersByTime(501);
      expect(cache.get('temp')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
