import { describe, expect, it, vi } from 'vitest';
import { mlAffLinkKey } from '@afilados/marketplaces';
import { withMlLinkCache, type LinkStore } from '../src/lib/ml-links';

function memoryStore(): LinkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
    del: async (k) => {
      data.delete(k);
    },
  };
}

const URL1 = 'https://www.mercadolivre.com.br/p/MLB1';

describe('withMlLinkCache', () => {
  it('devolve o link em cache sem gerar de novo', async () => {
    const store = memoryStore();
    store.data.set(mlAffLinkKey('t1', 'etq', URL1), 'https://meli.la/cached');
    const generate = vi.fn(async () => 'https://meli.la/new');
    expect(await withMlLinkCache('t1', 'etq', URL1, generate, store)).toBe(
      'https://meli.la/cached',
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('gera e guarda quando o link é um meli.la', async () => {
    const store = memoryStore();
    const generate = vi.fn(async () => 'https://meli.la/new');
    expect(await withMlLinkCache('t1', undefined, URL1, generate, store)).toBe(
      'https://meli.la/new',
    );
    expect(store.data.get(mlAffLinkKey('t1', undefined, URL1))).toBe('https://meli.la/new');
  });

  it('não guarda o link de fallback (matt_word) para não travar o oficial por 24 h', async () => {
    const store = memoryStore();
    const generate = vi.fn(async () => `${URL1}?matt_word=w&matt_tool=1`);
    await withMlLinkCache('t1', undefined, URL1, generate, store);
    expect(store.data.size).toBe(0);
  });

  it('falha do Redis não impede o envio', async () => {
    const broken: LinkStore = {
      get: async () => {
        throw new Error('redis fora');
      },
      set: async () => {
        throw new Error('redis fora');
      },
      del: async () => {},
    };
    expect(
      await withMlLinkCache('t1', undefined, URL1, async () => 'https://meli.la/x', broken),
    ).toBe('https://meli.la/x');
  });

  it('propaga o erro do gerador', async () => {
    await expect(
      withMlLinkCache(
        't1',
        undefined,
        URL1,
        async () => {
          throw new Error('gerador falhou');
        },
        memoryStore(),
      ),
    ).rejects.toThrow('gerador falhou');
  });
});
