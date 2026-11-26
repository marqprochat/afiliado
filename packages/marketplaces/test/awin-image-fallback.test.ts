import { describe, it, expect, vi } from 'vitest';
import {
  isImageAlive,
  resolveMerchantUrl,
  resolveVtexImage,
  resolveFallbackImage,
  runWithBudget,
  type ImageFallbackCache,
} from '../src/awin/image-fallback';

const DEAD_IMG =
  'https://io.convertiez.com.br/m/drogal/shop/products/images/9992251/large/fralda_31925.jpg';
const PCLICK = 'https://www.awin1.com/pclick.php?p=36610899908&a=691887&m=68224';
const MERCHANT = 'https://www.drogal.com.br/fraldas-pampers-premium-care-rn-36/p?utm_source=awin';
const VTEX_API =
  'https://www.drogal.com.br/api/catalog_system/pub/products/search/fraldas-pampers-premium-care-rn-36/p';
const VTEX_IMG = 'https://drogal.vteximg.com.br/arquivos/ids/265637/178278.jpg?v=1';

/** DNS falso: tudo resolve para um IP público, exceto hosts "internos". */
const lookup = async (host: string) =>
  host.includes('interno')
    ? [{ address: '10.0.0.5', family: 4 }]
    : [{ address: '8.8.8.8', family: 4 }];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(routes: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    return handler(url, init);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const image = () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });
const vtexJson = (imageUrl: string) =>
  new Response(JSON.stringify([{ items: [{ images: [{ imageUrl }] }] }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function memoryCache() {
  const store = new Map<string, { value: string; ttl: number }>();
  const cache: ImageFallbackCache = {
    get: async (k) => store.get(k)?.value ?? null,
    set: async (k, value, ttl) => {
      store.set(k, { value, ttl });
    },
  };
  return { cache, store };
}

describe('isImageAlive', () => {
  it('true para 2xx com content-type de imagem', async () => {
    const fetchImpl = fakeFetch({ [VTEX_IMG]: () => image() });
    expect(await isImageAlive(VTEX_IMG, { fetchImpl, lookup })).toBe(true);
  });

  it('false para 404', async () => {
    const fetchImpl = fakeFetch({});
    expect(await isImageAlive(DEAD_IMG, { fetchImpl, lookup })).toBe(false);
  });

  it('false quando o 200 não é imagem (página de erro HTML)', async () => {
    const fetchImpl = fakeFetch({
      [DEAD_IMG]: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    });
    expect(await isImageAlive(DEAD_IMG, { fetchImpl, lookup })).toBe(false);
  });

  it('cai para GET com Range quando o HEAD dá 405', async () => {
    const fetchImpl = fakeFetch({
      [VTEX_IMG]: (_u, init) =>
        init.method === 'HEAD'
          ? new Response(null, { status: 405 })
          : new Response('x', { status: 206, headers: { 'content-type': 'image/png' } }),
    });
    expect(await isImageAlive(VTEX_IMG, { fetchImpl, lookup })).toBe(true);
    const get = fetchImpl.mock.calls.find((c) => (c[1] as RequestInit).method === 'GET');
    expect((get![1] as RequestInit).headers).toMatchObject({ Range: 'bytes=0-0' });
  });

  it('não acessa host privado (anti-SSRF)', async () => {
    const fetchImpl = fakeFetch({});
    expect(await isImageAlive('http://interno.local/a.jpg', { fetchImpl, lookup })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('resolveMerchantUrl', () => {
  it('lê o parâmetro ued do cread.php sem fazer requisição', async () => {
    const fetchImpl = fakeFetch({});
    const link = `https://www.awin1.com/cread.php?awinmid=68224&awinaffid=1&ued=${encodeURIComponent(MERCHANT)}`;
    expect(await resolveMerchantUrl(link, { fetchImpl, lookup })).toBe(MERCHANT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lê o Location do pclick.php com redirect manual', async () => {
    const fetchImpl = fakeFetch({
      [PCLICK]: () => new Response(null, { status: 302, headers: { location: MERCHANT } }),
    });
    expect(await resolveMerchantUrl(PCLICK, { fetchImpl, lookup })).toBe(MERCHANT);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
  });

  it('rejeita Location para host privado ou não https', async () => {
    const toPrivate = fakeFetch({
      [PCLICK]: () =>
        new Response(null, { status: 302, headers: { location: 'https://interno.local/p' } }),
    });
    expect(await resolveMerchantUrl(PCLICK, { fetchImpl: toPrivate, lookup })).toBeNull();
    const toFile = fakeFetch({
      [PCLICK]: () =>
        new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
    });
    expect(await resolveMerchantUrl(PCLICK, { fetchImpl: toFile, lookup })).toBeNull();
  });

  it('rejeita ued apontando para host privado', async () => {
    const link = `https://www.awin1.com/cread.php?ued=${encodeURIComponent('https://interno.local/x/p')}`;
    expect(await resolveMerchantUrl(link, { fetchImpl: fakeFetch({}), lookup })).toBeNull();
  });
});

describe('resolveVtexImage', () => {
  it('consulta o catálogo público da VTEX pelo slug e devolve a primeira imagem', async () => {
    const fetchImpl = fakeFetch({ [VTEX_API]: () => vtexJson(VTEX_IMG) });
    expect(await resolveVtexImage(MERCHANT, { fetchImpl, lookup })).toBe(VTEX_IMG);
  });

  it('normaliza imagem http para https', async () => {
    const fetchImpl = fakeFetch({
      [VTEX_API]: () => vtexJson('http://drogal.vteximg.com.br/arquivos/ids/1/a.jpg'),
    });
    expect(await resolveVtexImage(MERCHANT, { fetchImpl, lookup })).toBe(
      'https://drogal.vteximg.com.br/arquivos/ids/1/a.jpg',
    );
  });

  it('null para URL que não é de produto VTEX (sem /p) e não faz requisição', async () => {
    const fetchImpl = fakeFetch({});
    expect(
      await resolveVtexImage('https://loja.com.br/produto/123', { fetchImpl, lookup }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('null quando a loja não responde JSON da VTEX', async () => {
    const fetchImpl = fakeFetch({ [VTEX_API]: () => new Response('<html>', { status: 200 }) });
    expect(await resolveVtexImage(MERCHANT, { fetchImpl, lookup })).toBeNull();
  });
});

describe('resolveFallbackImage', () => {
  it('mantém a imagem original quando ela está no ar', async () => {
    const fetchImpl = fakeFetch({ [VTEX_IMG]: () => image() });
    const r = await resolveFallbackImage(
      { imageUrl: VTEX_IMG, deepLink: PCLICK },
      { fetchImpl, lookup },
    );
    expect(r).toEqual({ url: VTEX_IMG, status: 'alive' });
  });

  it('imagem morta → resolve pela loja VTEX e grava no cache (7 dias)', async () => {
    const { cache, store } = memoryCache();
    const fetchImpl = fakeFetch({
      [PCLICK]: () => new Response(null, { status: 302, headers: { location: MERCHANT } }),
      [VTEX_API]: () => vtexJson(VTEX_IMG),
      [VTEX_IMG]: () => image(),
    });
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl, lookup, cache },
    );
    expect(r).toEqual({ url: VTEX_IMG, status: 'resolved' });
    const ttls = [...store.values()].map((v) => v.ttl);
    expect(ttls).toContain(7 * 24 * 3600);
  });

  it('cache hit: não faz nenhuma requisição', async () => {
    const { cache } = memoryCache();
    const routes = {
      [PCLICK]: () => new Response(null, { status: 302, headers: { location: MERCHANT } }),
      [VTEX_API]: () => vtexJson(VTEX_IMG),
      [VTEX_IMG]: () => image(),
    };
    await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      {
        fetchImpl: fakeFetch(routes),
        lookup,
        cache,
      },
    );
    const second = fakeFetch(routes);
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl: second, lookup, cache },
    );
    expect(r).toEqual({ url: VTEX_IMG, status: 'resolved' });
    expect(second).not.toHaveBeenCalled();
  });

  it('miss também vai para o cache (1 dia) e não repete as requisições', async () => {
    const { cache, store } = memoryCache();
    const first = fakeFetch({
      [PCLICK]: () =>
        new Response(null, { status: 302, headers: { location: 'https://loja.com.br/x/123' } }),
    });
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl: first, lookup, cache },
    );
    expect(r).toEqual({ url: DEAD_IMG, status: 'unresolved' });
    expect([...store.values()].map((v) => v.ttl)).toContain(24 * 3600);
    const second = fakeFetch({});
    const again = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl: second, lookup, cache },
    );
    expect(again.status).toBe('unresolved');
    expect(second).not.toHaveBeenCalled();
  });

  it('erro de rede vira unresolved, nunca exceção', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl, lookup },
    );
    expect(r).toEqual({ url: DEAD_IMG, status: 'unresolved' });
  });
});

describe('runWithBudget', () => {
  it('respeita o limite de concorrência e devolve só o que terminou dentro do prazo', async () => {
    let running = 0;
    let peak = 0;
    const items = [10, 10, 10, 10, 500];
    const results = await runWithBudget(
      items,
      async (ms) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, ms));
        running -= 1;
        return ms * 2;
      },
      { concurrency: 2, budgetMs: 100 },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.slice(0, 4)).toEqual([20, 20, 20, 20]);
    expect(results[4]).toBeUndefined();
  });
});
