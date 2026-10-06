import { describe, expect, it, vi } from 'vitest';
import {
  generateOfficialMlLink,
  generateOfficialMlLinks,
  ML_LINKBUILDER_BATCH_SIZE,
  ML_LINKBUILDER_PAGE,
} from '../src';

function resp(body: unknown, init: { status?: number; url?: string } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? 'https://www.mercadolivre.com.br/x',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const urls = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://www.mercadolivre.com.br/p/MLB${100 + i}`);

/** fetch simulado: 1ª chamada = painel (CSRF); as demais = createLink, tratadas por `onPost`. */
function mockFetch(onPost: (sent: string[], index: number, init: RequestInit) => Response) {
  let post = 0;
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (input === ML_LINKBUILDER_PAGE) return resp('<meta name="csrf-token" content="tok-1">');
    const body = JSON.parse(String(init?.body)) as { urls: string[]; tag: string };
    return onPost(body.urls, post++, init!);
  });
}

const okLinks = (sent: string[]) =>
  resp({
    urls: sent.map((u, i) => ({ origin_url: u, short_url: `https://meli.la/${i}${u.slice(-3)}` })),
  });

const cookies = { ssid: 'abc' };
const noSleep = async () => {};

describe('generateOfficialMlLinks (método 1: lote)', () => {
  it('divide 45 URLs em lotes de 20, abre o painel uma vez e pausa entre lotes', async () => {
    expect(ML_LINKBUILDER_BATCH_SIZE).toBe(20);
    const fetchImpl = mockFetch((sent) => okLinks(sent));
    const sleep = vi.fn(async () => {});
    const input = urls(45);
    const r = await generateOfficialMlLinks(input, cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      pauseMs: 2500,
      tag: 'minha-tag',
    });
    expect(r.links.size).toBe(45);
    expect(r.failures).toEqual([]);
    // 1 painel + 3 createLink
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const sizes = fetchImpl.mock.calls
      .slice(1)
      .map((c) => JSON.parse(String(c[1]?.body)).urls.length);
    expect(sizes).toEqual([20, 20, 5]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).tag).toBe('minha-tag');
    const headers = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('tok-1');
    expect(headers.Cookie).toBe('ssid=abc');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2500);
  });

  it('casa a resposta com a URL enviada mesmo quando origin_url vem sem fragmento/query', async () => {
    const sent = 'https://www.mercadolivre.com.br/produto/p/MLB46202402#wid=MLB4083441037';
    const fetchImpl = mockFetch(() =>
      resp({
        urls: [
          {
            origin_url: 'https://www.mercadolivre.com.br/produto/p/MLB46202402',
            short_url: 'https://meli.la/1AbC',
          },
        ],
      }),
    );
    const r = await generateOfficialMlLinks([sent], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.get(sent)).toBe('https://meli.la/1AbC');
  });

  it('um lote com erro HTTP vira falha e os outros lotes seguem', async () => {
    const fetchImpl = mockFetch((sent, i) =>
      i === 0 ? resp('boom', { status: 500 }) : okLinks(sent),
    );
    const r = await generateOfficialMlLinks(urls(25), cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.size).toBe(5);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]?.urls).toHaveLength(20);
    expect(r.failures[0]?.message).toMatch(/HTTP 500/);
  });

  it('entrada sem short_url fica de fora sem virar falha do lote', async () => {
    const [a, b] = urls(2) as [string, string];
    const fetchImpl = mockFetch(() =>
      resp({ urls: [{ origin_url: a, short_url: 'https://meli.la/ok1' }, { origin_url: b }] }),
    );
    const r = await generateOfficialMlLinks([a, b], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect([...r.links.keys()]).toEqual([a]);
    expect(r.failures).toEqual([]);
  });

  it('resposta sem a lista urls[] vira falha do lote', async () => {
    const fetchImpl = mockFetch(() => resp({ erro: 'formato novo' }));
    const r = await generateOfficialMlLinks(urls(3), cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(r.links.size).toBe(0);
    expect(r.failures[0]?.message).toMatch(/lista de links/);
  });

  it('deduplica as URLs', async () => {
    const fetchImpl = mockFetch((sent) => okLinks(sent));
    const [a] = urls(1) as [string];
    const r = await generateOfficialMlLinks([a, a, a], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).urls).toEqual([a]);
    expect(r.links.size).toBe(1);
  });

  it('sessão expirada (painel redireciona para login) lança ML_SESSION_EXPIRED', async () => {
    const fetchImpl = vi.fn(async () =>
      resp('', { url: 'https://www.mercadolivre.com.br/login?x' }),
    );
    await expect(
      generateOfficialMlLinks(urls(2), cookies, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
  });

  it('403 no createLink lança ML_SESSION_EXPIRED', async () => {
    const fetchImpl = mockFetch(() => resp('', { status: 403 }));
    await expect(
      generateOfficialMlLinks(urls(2), cookies, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
  });

  it('sem cookies lança ML_SESSION_EXPIRED antes de qualquer requisição', async () => {
    const fetchImpl = vi.fn();
    await expect(
      generateOfficialMlLinks(urls(1), {}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lista vazia não faz requisição', async () => {
    const fetchImpl = vi.fn();
    const r = await generateOfficialMlLinks([], cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.links.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('generateOfficialMlLink (método 2) com etiqueta', () => {
  it('envia a etiqueta no corpo e mantém tag vazia por padrão', async () => {
    const fetchImpl = mockFetch(() => resp({ urls: [{ short_url: 'https://meli.la/abc123' }] }));
    const u = 'https://www.mercadolivre.com.br/p/MLB1';
    await generateOfficialMlLink(u, cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tag: 'etq',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      urls: [u],
      tag: 'etq',
    });

    const fetch2 = mockFetch(() => resp({ urls: [{ short_url: 'https://meli.la/abc123' }] }));
    await generateOfficialMlLink(u, cookies, { fetchImpl: fetch2 as unknown as typeof fetch });
    expect(JSON.parse(String(fetch2.mock.calls[1]?.[1]?.body)).tag).toBe('');
  });
});
