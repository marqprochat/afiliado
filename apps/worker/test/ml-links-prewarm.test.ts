import { describe, expect, it, vi } from 'vitest';
import {
  ML_AFF_LINK_TTL_SEC,
  MlSessionError,
  mlAffLinkKey,
  mlLinksErrorKey,
} from '@afilados/marketplaces';
import { runMlLinksPrewarm } from '../src/processors/ml-links-prewarm';
import type { LinkStore } from '../src/lib/ml-links';

function memoryStore() {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const store: LinkStore = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v, ttl) => {
      data.set(k, v);
      ttls.set(k, ttl);
    },
    del: async (k) => {
      data.delete(k);
    },
  };
  return { store, data, ttls };
}

const creds = {
  mlSession: { cookies: { ssid: 'abc' }, syncedAt: '2026-10-05T00:00:00Z' },
  tag: 'etq',
};
const U = (n: number) => `https://www.mercadolivre.com.br/p/MLB${n}`;

describe('runMlLinksPrewarm', () => {
  it('sem sessão do ML sincronizada: ignora, sem registrar erro', async () => {
    const { store, data } = memoryStore();
    const generateBatch = vi.fn();
    const r = await runMlLinksPrewarm(
      { loadCredentials: async () => ({}), store, generateBatch },
      { tenantId: 't1', urls: [U(1)] },
    );
    expect(r).toEqual({ skipped: 'sem-sessao' });
    expect(generateBatch).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });

  it('guarda os links no Redis com TTL de 24 h e limpa o erro anterior', async () => {
    const { store, data, ttls } = memoryStore();
    data.set(mlLinksErrorKey('t1'), '{"at":"x"}');
    const generateBatch = vi.fn(async (urls: string[]) => ({
      links: new Map(urls.map((u) => [u, `https://meli.la/${u.slice(-3)}`])),
      failures: [],
    }));
    const r = await runMlLinksPrewarm(
      { loadCredentials: async () => creds, store, generateBatch, sleep: async () => {} },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(r).toMatchObject({ viaBatch: 2, viaFallback: 0 });
    const key = mlAffLinkKey('t1', 'etq', U(1));
    expect(data.get(key)).toBe('https://meli.la/LB1');
    expect(ttls.get(key)).toBe(ML_AFF_LINK_TTL_SEC);
    expect(data.has(mlLinksErrorKey('t1'))).toBe(false);
    expect(generateBatch.mock.calls[0]?.[0]).toEqual([U(1), U(2)]);
  });

  it('pula as URLs que já estão em cache', async () => {
    const { store, data } = memoryStore();
    data.set(mlAffLinkKey('t1', 'etq', U(1)), 'https://meli.la/ja');
    const generateBatch = vi.fn(async (urls: string[]) => ({
      links: new Map(urls.map((u) => [u, 'https://meli.la/novo'])),
      failures: [],
    }));
    await runMlLinksPrewarm(
      { loadCredentials: async () => creds, store, generateBatch, sleep: async () => {} },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(generateBatch.mock.calls[0]?.[0]).toEqual([U(2)]);
  });

  it('lote falha: usa o método individual e grava o erro para o card', async () => {
    const { store, data } = memoryStore();
    const generateBatch = vi.fn(async () => {
      throw new Error('formato mudou');
    });
    const generateSingle = vi.fn(async (u: string) => `https://meli.la/s${u.slice(-3)}`);
    const r = await runMlLinksPrewarm(
      {
        loadCredentials: async () => creds,
        store,
        generateBatch,
        generateSingle,
        sleep: async () => {},
        now: () => new Date('2026-10-05T17:30:00.000Z'),
      },
      { tenantId: 't1', urls: [U(1), U(2)] },
    );
    expect(r).toMatchObject({ viaBatch: 0, viaFallback: 2 });
    expect(JSON.parse(data.get(mlLinksErrorKey('t1'))!)).toEqual({
      at: '2026-10-05T17:30:00.000Z',
      message: 'formato mudou',
      urls: 2,
      recoveredByFallback: 2,
    });
    expect(data.get(mlAffLinkKey('t1', 'etq', U(1)))).toBe('https://meli.la/sLB1');
  });

  it('sessão expirada: registra o erro e não usa o método individual', async () => {
    const { store, data } = memoryStore();
    const generateSingle = vi.fn();
    await runMlLinksPrewarm(
      {
        loadCredentials: async () => creds,
        store,
        generateBatch: async () => {
          throw new MlSessionError('Sessão do Mercado Livre expirou', 'ML_SESSION_EXPIRED');
        },
        generateSingle,
        sleep: async () => {},
      },
      { tenantId: 't1', urls: [U(1)] },
    );
    expect(generateSingle).not.toHaveBeenCalled();
    expect(JSON.parse(data.get(mlLinksErrorKey('t1'))!).message).toMatch(/expirou/);
  });
});
