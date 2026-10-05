import { describe, expect, it, vi } from 'vitest';
import {
  createTagAdapter,
  ML_AFF_LINK_TTL_SEC,
  MlSessionError,
  mlAffLinkKey,
  mlLinksErrorKey,
  prewarmMlAffiliateLinks,
  type BatchLinkResult,
  type MlLinkBatchError,
  type PrewarmDeps,
} from '../src';

const NOW = new Date('2026-10-05T17:30:00.000Z');
const U = (n: number) => `https://www.mercadolivre.com.br/p/MLB${n}`;

function makeDeps(over: Partial<PrewarmDeps> = {}) {
  const stored = new Map<string, string>();
  const errors: MlLinkBatchError[] = [];
  const deps: PrewarmDeps = {
    generateBatch: vi.fn(async (urls: string[]): Promise<BatchLinkResult> => ({
      links: new Map(urls.map((u) => [u, `https://meli.la/${u.slice(-3)}`])),
      failures: [],
    })),
    generateSingle: vi.fn(async (u: string) => `https://meli.la/single-${u.slice(-3)}`),
    store: vi.fn(async (u: string, l: string) => {
      stored.set(u, l);
    }),
    recordError: vi.fn(async (e: MlLinkBatchError) => {
      errors.push(e);
    }),
    clearError: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    now: () => NOW,
    fallbackPauseMs: 1000,
    ...over,
  };
  return { deps, stored, errors };
}

describe('chaves do Redis', () => {
  it('chave do link inclui tenant, etiqueta (ou default) e o sha1 da URL', () => {
    const a = mlAffLinkKey('t1', 'minha', U(1));
    const b = mlAffLinkKey('t1', undefined, U(1));
    expect(a).toMatch(/^ml-aff-link:t1:minha:[0-9a-f]{40}$/);
    expect(b).toMatch(/^ml-aff-link:t1:default:[0-9a-f]{40}$/);
    expect(mlAffLinkKey('t1', '  ', U(1))).toBe(b);
    expect(mlAffLinkKey('t2', 'minha', U(1))).not.toBe(a);
    expect(mlAffLinkKey('t1', 'minha', U(2))).not.toBe(a);
    expect(ML_AFF_LINK_TTL_SEC).toBe(86400);
    expect(mlLinksErrorKey('t1')).toBe('ml-links-batch:last-error:t1');
  });
});

describe('prewarmMlAffiliateLinks', () => {
  it('tudo pelo lote: guarda os links e limpa o erro anterior', async () => {
    const { deps, stored } = makeDeps();
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(2)], deps);
    expect(r).toEqual({ viaBatch: 2, viaFallback: 0, failed: 0, sessionExpired: false });
    expect(stored.size).toBe(2);
    expect(deps.generateSingle).not.toHaveBeenCalled();
    expect(deps.clearError).toHaveBeenCalledTimes(1);
    expect(deps.recordError).not.toHaveBeenCalled();
  });

  it('lote lança erro: cai no método individual, guarda o erro com o que foi salvo', async () => {
    const { deps, stored, errors } = makeDeps({
      generateBatch: vi.fn(async () => {
        throw new Error('formato de resposta mudou');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(r).toEqual({ viaBatch: 0, viaFallback: 3, failed: 0, sessionExpired: false });
    expect(stored.size).toBe(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(1000);
    expect(errors).toEqual([
      {
        at: NOW.toISOString(),
        message: 'formato de resposta mudou',
        urls: 3,
        recoveredByFallback: 3,
      },
    ]);
    expect(deps.clearError).not.toHaveBeenCalled();
  });

  it('lote devolve só parte: o que faltou vai para o método individual', async () => {
    const { deps, stored, errors } = makeDeps({
      generateBatch: vi.fn(async (urls: string[]) => ({
        links: new Map([[urls[0]!, 'https://meli.la/ok']]),
        failures: [],
      })),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2)], deps);
    expect(r).toMatchObject({ viaBatch: 1, viaFallback: 1, failed: 0 });
    expect(stored.get(U(2))).toBe('https://meli.la/single-LB2');
    expect(errors[0]).toMatchObject({ urls: 1, recoveredByFallback: 1 });
    expect(errors[0]?.message).toMatch(/não devolveu/i);
  });

  it('usa a mensagem da falha do lote quando existe', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async (urls: string[]) => ({
        links: new Map(),
        failures: [{ urls, message: 'Gerador de links do ML respondeu HTTP 500' }],
      })),
    });
    await prewarmMlAffiliateLinks([U(1)], deps);
    expect(errors[0]?.message).toBe('Gerador de links do ML respondeu HTTP 500');
  });

  it('método individual também falha em alguns: conta como failed e informa quantos foram salvos', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async () => ({ links: new Map(), failures: [] })),
      generateSingle: vi.fn(async (u: string) => {
        if (u === U(2)) throw new MlSessionError('x', 'ML_LINKBUILDER_ERROR');
        return `https://meli.la/${u.slice(-3)}`;
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(r).toMatchObject({ viaFallback: 2, failed: 1 });
    expect(errors[0]).toMatchObject({ urls: 3, recoveredByFallback: 2 });
  });

  it('sessão expirada no lote: não usa o método individual e registra o erro', async () => {
    const { deps, errors } = makeDeps({
      generateBatch: vi.fn(async () => {
        throw new MlSessionError('Sessão do Mercado Livre expirou', 'ML_SESSION_EXPIRED');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2)], deps);
    expect(r).toEqual({ viaBatch: 0, viaFallback: 0, failed: 2, sessionExpired: true });
    expect(deps.generateSingle).not.toHaveBeenCalled();
    expect(errors[0]).toMatchObject({ urls: 2, recoveredByFallback: 0 });
    expect(errors[0]?.message).toMatch(/expirou/);
  });

  it('sessão expira no meio do método individual: interrompe os que faltam', async () => {
    const { deps } = makeDeps({
      generateBatch: vi.fn(async () => ({ links: new Map(), failures: [] })),
      generateSingle: vi.fn(async () => {
        throw new MlSessionError('Sessão expirou', 'ML_SESSION_EXPIRED');
      }),
    });
    const r = await prewarmMlAffiliateLinks([U(1), U(2), U(3)], deps);
    expect(deps.generateSingle).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ failed: 3, sessionExpired: true });
  });

  it('lista vazia não chama nada', async () => {
    const { deps } = makeDeps();
    expect(await prewarmMlAffiliateLinks([], deps)).toEqual({
      viaBatch: 0,
      viaFallback: 0,
      failed: 0,
      sessionExpired: false,
    });
    expect(deps.generateBatch).not.toHaveBeenCalled();
    expect(deps.clearError).not.toHaveBeenCalled();
  });
});

describe('adapter do ML com etiqueta', () => {
  const cookies = { ssid: 'abc' };
  const session = { cookies, syncedAt: '2026-10-05T00:00:00Z' };

  it('repassa a etiqueta ao gerador e não mistura o cache de etiquetas diferentes', async () => {
    const gen = vi.fn(
      async (_u: string, _c: Record<string, string>, tag?: string) =>
        `https://meli.la/${tag ?? 'padrao'}`,
    );
    const adapter = createTagAdapter('MERCADOLIVRE', { mlOfficialLink: gen });
    const url = 'https://www.mercadolivre.com.br/p/MLB555';
    const withTag = { mlSession: session, tag: 'etq' };
    expect(await adapter.toAffiliateLink(withTag, url)).toBe('https://meli.la/etq');
    expect(await adapter.toAffiliateLink(withTag, url)).toBe('https://meli.la/etq');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenLastCalledWith(url, cookies, 'etq');
    expect(await adapter.toAffiliateLink({ mlSession: session }, url)).toBe(
      'https://meli.la/padrao',
    );
    expect(gen).toHaveBeenCalledTimes(2);
  });
});
