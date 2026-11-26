import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isImageAlive,
  resolveMerchantUrl,
  resolveVtexImage,
  resolveFallbackImage,
  slugFromImageUrl,
  titlesMatch,
  defaultMerchantOrigins,
  runWithBudget,
  type ImageFallbackCache,
} from '../src/awin/image-fallback';

const SLUG = 'fraldas-pampers-premium-care-rn-36';
const DEAD_IMG = `https://io.convertiez.com.br/m/drogal/shop/products/images/9992251/large/${SLUG}_31925.jpg`;
const PCLICK = 'https://www.awin1.com/pclick.php?p=36610899908&a=691887&m=68224';
const MERCHANT = `https://www.drogal.com.br/${SLUG}/p?utm_source=awin`;
const VTEX_API = `https://www.drogal.com.br/api/catalog_system/pub/products/search/${SLUG}/p`;
const VTEX_IMG = 'https://drogal.vteximg.com.br/arquivos/ids/265637/178278.jpg?v=1';
const TITLE = 'Fraldas Pampers Recém Nascido Premium Care Rn 36 Unidades';
const FT_API = `https://www.drogal.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(TITLE)}&_from=0&_to=0`;

/** DNS falso: tudo resolve para um IP público, exceto hosts "internos". */
const lookup = async (host: string) =>
  host.includes('interno')
    ? [{ address: '10.0.0.5', family: 4 }]
    : [{ address: '8.8.8.8', family: 4 }];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Toda URL pedida a qualquer fetch falso; nenhuma pode ser da Awin. */
const requested: string[] = [];
afterEach(() => {
  expect(requested.filter((u) => /(^|\.)awin1\.com$/i.test(new URL(u).hostname))).toEqual([]);
  requested.length = 0;
});

function fakeFetch(routes: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    requested.push(url);
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    return handler(url, init);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const image = () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });
const vtexJson = (imageUrl: string, productName = 'Produto') =>
  new Response(JSON.stringify([{ productName, items: [{ images: [{ imageUrl }] }] }]), {
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
    expect(await isImageAlive(DEAD_IMG, { fetchImpl: fakeFetch({}), lookup })).toBe(false);
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

  it('não acessa link da Awin nem segue redirect para ela', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: PCLICK } }),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await isImageAlive(PCLICK, { fetchImpl, lookup })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await isImageAlive('https://cdn.loja.com/a.jpg', { fetchImpl, lookup })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('resolveMerchantUrl (sem rede)', () => {
  it('cread.php: usa o parâmetro ued', async () => {
    const fetchImpl = fakeFetch({});
    const link = `https://www.awin1.com/cread.php?awinmid=68224&awinaffid=1&ued=${encodeURIComponent(MERCHANT)}`;
    expect(await resolveMerchantUrl(link, { fetchImpl, lookup })).toEqual({
      origin: 'https://www.drogal.com.br',
      productUrl: MERCHANT,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pclick.php: mapeia o anunciante (m) para a origem da loja', async () => {
    const fetchImpl = fakeFetch({});
    expect(await resolveMerchantUrl(PCLICK, { fetchImpl, lookup })).toEqual({
      origin: 'https://www.drogal.com.br',
      productUrl: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cread.php sem ued usa awinmid; mapa injetado tem prioridade', async () => {
    const link = 'https://www.awin1.com/cread.php?awinmid=999&awinaffid=1';
    expect(await resolveMerchantUrl(link, { lookup })).toBeNull();
    expect(
      await resolveMerchantUrl(link, {
        lookup,
        merchantOrigins: { '999': 'https://www.loja.com' },
      }),
    ).toEqual({ origin: 'https://www.loja.com', productUrl: null });
  });

  it('mapa padrão vem de DEFAULT_AWIN_PARTNERS', () => {
    expect(defaultMerchantOrigins()['68224']).toBe('https://www.drogal.com.br');
  });

  it('rejeita destino privado ou não https', async () => {
    const priv = `https://www.awin1.com/cread.php?ued=${encodeURIComponent('https://interno.local/x/p')}`;
    expect(await resolveMerchantUrl(priv, { lookup })).toBeNull();
    const http = `https://www.awin1.com/cread.php?ued=${encodeURIComponent('http://www.drogal.com.br/x/p')}`;
    expect(await resolveMerchantUrl(http, { lookup })).toBeNull();
    expect(
      await resolveMerchantUrl(PCLICK, {
        lookup,
        merchantOrigins: { '68224': 'https://interno.local' },
      }),
    ).toBeNull();
  });
});

describe('slugFromImageUrl', () => {
  it('tira extensão e o sufixo _<dígitos>', () => {
    expect(
      slugFromImageUrl(
        'https://io.convertiez.com.br/m/drogal/shop/products/images/9992251/large/fraldas-pampers-premium-care-recem-nascido-rn-36-unidades_31925.jpg',
      ),
    ).toBe('fraldas-pampers-premium-care-recem-nascido-rn-36-unidades');
  });

  it('null para nome que não parece slug', () => {
    expect(slugFromImageUrl('https://cdn.loja.com/img/123456.jpg')).toBeNull();
    expect(slugFromImageUrl('https://cdn.loja.com/img/a%20b-c.jpg')).toBeNull();
    expect(slugFromImageUrl(null)).toBeNull();
  });
});

describe('titlesMatch', () => {
  it('ignora ordem, acentos, caixa e pontuação', () => {
    expect(titlesMatch(TITLE, 'Fraldas Pampers Premium Care Recém-Nascido RN 36 Unidades')).toBe(
      true,
    );
  });
  it('RN e RN+ são produtos diferentes', () => {
    expect(titlesMatch(TITLE, 'Fraldas Pampers Recém Nascido Premium Care RN+ 36 Unidades')).toBe(
      false,
    );
  });
  it('produto diferente não bate', () => {
    expect(titlesMatch(TITLE, 'Fraldas Pampers Premium Care M 80 Unidades')).toBe(false);
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

  it('pclick + imagem morta → slug do nome do arquivo na VTEX, sem tocar na Awin; cache 7 dias', async () => {
    const { cache, store } = memoryCache();
    const fetchImpl = fakeFetch({
      [VTEX_API]: () => vtexJson(VTEX_IMG),
      [VTEX_IMG]: () => image(),
    });
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl, lookup, cache },
    );
    expect(r).toEqual({ url: VTEX_IMG, status: 'resolved' });
    expect([...store.values()].map((v) => v.ttl)).toContain(7 * 24 * 3600);
  });

  it('slug do ued tem preferência sobre o do nome da imagem', async () => {
    const other = 'https://www.drogal.com.br/outro-slug/p';
    const otherApi =
      'https://www.drogal.com.br/api/catalog_system/pub/products/search/outro-slug/p';
    const fetchImpl = fakeFetch({
      [otherApi]: () => vtexJson(VTEX_IMG),
      [VTEX_IMG]: () => image(),
    });
    const link = `https://www.awin1.com/cread.php?awinmid=68224&ued=${encodeURIComponent(other)}`;
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: link },
      { fetchImpl, lookup },
    );
    expect(r.status).toBe('resolved');
    const vtexCalls = requested.filter((u) => u.includes('/api/catalog_system/'));
    expect(vtexCalls[0]).toBe(otherApi);
  });

  it('sem slug: busca pelo título e aceita só se o nome bater', async () => {
    const noSlugImg = 'https://io.convertiez.com.br/m/drogal/123.jpg';
    const ok = fakeFetch({
      [FT_API]: () =>
        vtexJson(VTEX_IMG, 'Fraldas Pampers Premium Care Recém-Nascido RN 36 Unidades'),
      [VTEX_IMG]: () => image(),
    });
    expect(
      await resolveFallbackImage(
        { imageUrl: noSlugImg, deepLink: PCLICK, title: TITLE },
        { fetchImpl: ok, lookup },
      ),
    ).toEqual({ url: VTEX_IMG, status: 'resolved' });

    const wrong = fakeFetch({
      [FT_API]: () => vtexJson(VTEX_IMG, 'Fraldas Pampers Premium Care G 64 Unidades'),
      [VTEX_IMG]: () => image(),
    });
    expect(
      (
        await resolveFallbackImage(
          { imageUrl: noSlugImg, deepLink: PCLICK, title: TITLE },
          { fetchImpl: wrong, lookup },
        )
      ).status,
    ).toBe('unresolved');
  });

  describe('com título: confere o nome do produto achado pelo slug', () => {
    const RN_PLUS = 'Fraldas Pampers Recém Nascido Premium Care RN+ 36 Unidades';
    const RN = 'Fraldas Pampers Recém Nascido Premium Care RN 36 Unidades';
    const TITLE_IMG = 'https://drogal.vteximg.com.br/arquivos/ids/288819/206416.jpg';

    it('slug com nome igual ao título: aceita sem buscar pelo título', async () => {
      const fetchImpl = fakeFetch({
        [VTEX_API]: () => vtexJson(VTEX_IMG, RN),
        [VTEX_IMG]: () => image(),
      });
      const r = await resolveFallbackImage(
        { imageUrl: DEAD_IMG, deepLink: PCLICK, title: TITLE },
        { fetchImpl, lookup },
      );
      expect(r).toEqual({ url: VTEX_IMG, status: 'resolved' });
      expect(requested).not.toContain(FT_API);
    });

    it('slug com outro nome e busca pelo título acha o produto: usa a da busca', async () => {
      const fetchImpl = fakeFetch({
        [VTEX_API]: () => vtexJson(VTEX_IMG, RN_PLUS),
        [VTEX_IMG]: () => image(),
        [FT_API]: () => vtexJson(TITLE_IMG, RN),
        [TITLE_IMG]: () => image(),
      });
      const r = await resolveFallbackImage(
        { imageUrl: DEAD_IMG, deepLink: PCLICK, title: TITLE },
        { fetchImpl, lookup },
      );
      expect(r).toEqual({ url: TITLE_IMG, status: 'resolved' });
    });

    it('slug com outro nome e busca sem produto equivalente: fica com a do slug', async () => {
      const fetchImpl = fakeFetch({
        [VTEX_API]: () => vtexJson(VTEX_IMG, RN_PLUS),
        [VTEX_IMG]: () => image(),
        [FT_API]: () => vtexJson(TITLE_IMG, 'Lenço Umedecido Pampers 48 Unidades'),
        [TITLE_IMG]: () => image(),
      });
      const r = await resolveFallbackImage(
        { imageUrl: DEAD_IMG, deepLink: PCLICK, title: TITLE },
        { fetchImpl, lookup },
      );
      expect(r).toEqual({ url: VTEX_IMG, status: 'resolved' });
    });
  });

  it('cache hit: não faz nenhuma requisição', async () => {
    const { cache } = memoryCache();
    const routes = { [VTEX_API]: () => vtexJson(VTEX_IMG), [VTEX_IMG]: () => image() };
    await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: PCLICK },
      { fetchImpl: fakeFetch(routes), lookup, cache },
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
    const unknownAdvertiser = 'https://www.awin1.com/pclick.php?p=1&m=999';
    const r = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: unknownAdvertiser },
      { fetchImpl: fakeFetch({}), lookup, cache },
    );
    expect(r).toEqual({ url: DEAD_IMG, status: 'unresolved' });
    expect([...store.values()].map((v) => v.ttl)).toContain(24 * 3600);
    const second = fakeFetch({});
    const again = await resolveFallbackImage(
      { imageUrl: DEAD_IMG, deepLink: unknownAdvertiser },
      { fetchImpl: second, lookup, cache },
    );
    expect(again.status).toBe('unresolved');
    expect(second).not.toHaveBeenCalled();
  });

  it('erro de rede vira unresolved, nunca exceção', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input));
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
