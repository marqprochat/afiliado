import { describe, expect, it, vi } from 'vitest';
import {
  AWIN_SHORT_LINKS_KEY,
  createAwinShortener,
  memoryShortenerStore,
  type AwinShortenerDeps,
} from '../src/lib/awin-short-links';

const CREAD =
  'https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2Fp&clickref=sub1&clickref2=wABCDE&clickref3=lote1';
const creds = { publisherId: '691887', offersApiToken: 'tok' };
const on = { [AWIN_SHORT_LINKS_KEY]: true };

function makeDeps<O extends Partial<AwinShortenerDeps>>(over: O = {} as O) {
  let n = 0;
  // Relógio virtual: a espera do limitador avança o tempo em vez de dormir.
  let clock = 0;
  const deps = {
    now: () => clock,
    store: memoryShortenerStore(),
    getQuota: vi.fn(async () => ({ limit: 50, usage: 10, remaining: 40 })),
    generate: vi.fn(async () => ({ url: CREAD, shortUrl: `https://tidd.ly/s${++n}` })),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...over,
  };
  return deps;
}

describe('createAwinShortener', () => {
  it('setting desligado: devolve o link longo sem chamar a Awin', async () => {
    const deps = makeDeps();
    const s = createAwinShortener({ tenantId: 't1', settings: {}, creds, channels: 2 }, deps);
    expect(await s.shorten(CREAD)).toBe(CREAD);
    expect(deps.getQuota).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('ligado + cota suficiente: gera um link curto por canal com os clickrefs do canal', async () => {
    const deps = makeDeps();
    const s = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 2 }, deps);
    expect(await s.shorten(CREAD)).toBe('https://tidd.ly/s1');
    expect(await s.shorten(CREAD.replace('wABCDE', 'wFGHIJ'))).toBe('https://tidd.ly/s2');
    expect(deps.getQuota).toHaveBeenCalledTimes(1);
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(deps.generate.mock.calls[0]).toEqual([
      creds,
      {
        advertiserId: 68224,
        destinationUrl: 'https://www.drogal.com.br/p',
        parameters: { clickref: 'sub1', clickref2: 'wABCDE', clickref3: 'lote1' },
      },
      { shorten: true },
    ]);
    expect((deps.generate.mock.calls[1] as unknown[])[1]).toMatchObject({
      parameters: { clickref2: 'wFGHIJ' },
    });
  });

  it('respeita 1 chamada a cada 3,1 s por tenant (espera entre as gerações)', async () => {
    let clock = 0;
    const deps = makeDeps({
      now: () => clock,
      sleep: vi.fn(async (ms: number) => {
        clock += ms;
      }),
    });
    const s = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 3 }, deps);
    await s.shorten(CREAD);
    await s.shorten(CREAD);
    await s.shorten(CREAD);
    const waited = deps.sleep.mock.calls.reduce((a, [ms]) => a + (ms as number), 0);
    expect(waited).toBeGreaterThanOrEqual(2 * 3100);
  });

  it('cota insuficiente para os canais: mantém o link longo', async () => {
    const deps = makeDeps({ getQuota: vi.fn(async () => ({ limit: 50, usage: 49, remaining: 1 })) });
    const s = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 2 }, deps);
    expect(await s.shorten(CREAD)).toBe(CREAD);
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('cota sem limite conhecido: mantém o link longo', async () => {
    const deps = makeDeps({ getQuota: vi.fn(async () => ({ limit: null, usage: 0, remaining: null })) });
    const s = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 1 }, deps);
    expect(await s.shorten(CREAD)).toBe(CREAD);
  });

  it('erro na cota ou na geração: mantém o link longo', async () => {
    const a = makeDeps({ getQuota: vi.fn(async () => Promise.reject(new Error('x'))) });
    expect(
      await createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 1 }, a).shorten(CREAD),
    ).toBe(CREAD);
    const b = makeDeps({ generate: vi.fn(async () => Promise.reject(new Error('429'))) });
    expect(
      await createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 1 }, b).shorten(CREAD),
    ).toBe(CREAD);
    const c = makeDeps({ generate: vi.fn(async () => ({ url: CREAD, shortUrl: null })) });
    expect(
      await createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 1 }, c).shorten(CREAD),
    ).toBe(CREAD);
  });

  it('cota em cache (10 min) é reaproveitada e descontada a cada link curto', async () => {
    const deps = makeDeps({ getQuota: vi.fn(async () => ({ limit: 3, usage: 0, remaining: 3 })) });
    const first = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 2 }, deps);
    await first.shorten(CREAD);
    await first.shorten(CREAD);
    const second = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 2 }, deps);
    expect(await second.shorten(CREAD)).toBe(CREAD);
    expect(deps.getQuota).toHaveBeenCalledTimes(1);
    expect(deps.generate).toHaveBeenCalledTimes(2);
  });

  it('não encurta link do site, pclick.php nem outras lojas', async () => {
    const deps = makeDeps();
    const s = createAwinShortener({ tenantId: 't1', settings: on, creds, channels: 1 }, deps);
    for (const link of [
      'https://site.test/ofertas/produto?c=wABCDE&b=1',
      'https://www.awin1.com/pclick.php?p=1&a=2&m=3',
      'https://s.shopee.com.br/AFF1',
    ]) {
      expect(await s.shorten(link)).toBe(link);
    }
    expect(deps.getQuota).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('sem token da Awin: link longo', async () => {
    const deps = makeDeps();
    const s = createAwinShortener(
      { tenantId: 't1', settings: on, creds: { publisherId: '1' }, channels: 1 },
      deps,
    );
    expect(await s.shorten(CREAD)).toBe(CREAD);
    expect(deps.getQuota).not.toHaveBeenCalled();
  });

  it('com os clientes reais, só requisita api.awin.com (nunca o link de rastreio)', async () => {
    const hosts: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      hosts.push(new URL(url).hostname);
      const body = url.endsWith('/quota')
        ? { limit: 10, usage: 0 }
        : { url: CREAD, shortUrl: 'https://tidd.ly/real' };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const s = createAwinShortener(
        { tenantId: 't-real', settings: on, creds, channels: 1 },
        { store: memoryShortenerStore(), sleep: async () => undefined },
      );
      expect(await s.shorten(CREAD)).toBe('https://tidd.ly/real');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(hosts).toEqual(['api.awin.com', 'api.awin.com']);
  });
});
