import { describe, it, expect, vi } from 'vitest';
import { resolveShortLinks } from '../src/mirror/resolve-short-links';

function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null,
    },
    body: undefined,
  } as unknown as Response;
}

describe('resolveShortLinks', () => {
  it('resolve encurtador conhecido e devolve o mapa curta → expandida', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://meli.la/1h21Ywb') {
        return fakeResponse(302, { location: 'https://www.mercadolivre.com.br/p/MLB123456789' });
      }
      throw new Error('url inesperada: ' + url);
    });
    const out = await resolveShortLinks('Confira: https://meli.la/1h21Ywb', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.get('https://meli.la/1h21Ywb')).toBe(
      'https://www.mercadolivre.com.br/p/MLB123456789',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('envia User-Agent de navegador (meli.la devolve 403 para fetch sem UA)', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(301, { location: 'https://www.mercadolivre.com.br/p/MLB123456789' }),
    );
    await resolveShortLinks('https://meli.la/1TWnuiM', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/Mozilla\/5\.0/);
  });

  it('expande br.shp.ee e shp.ee (encurtador da Shopee)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://br.shp.ee/jn9N8Wkp') {
        return fakeResponse(301, {
          location: 'https://shopee.com.br/product/683952730/54252536066?d_id=5d050',
        });
      }
      if (url === 'https://shp.ee/xyz123') {
        return fakeResponse(301, {
          location: 'https://shopee.com.br/product/111/222',
        });
      }
      throw new Error('url inesperada: ' + url);
    });
    const out = await resolveShortLinks(
      'Shopee: https://br.shp.ee/jn9N8Wkp e https://shp.ee/xyz123',
      {
        fetch: fetchMock as unknown as typeof fetch,
      },
    );
    expect(out.get('https://br.shp.ee/jn9N8Wkp')).toBe(
      'https://shopee.com.br/product/683952730/54252536066?d_id=5d050',
    );
    expect(out.get('https://shp.ee/xyz123')).toBe('https://shopee.com.br/product/111/222');
  });

  it('expande meli.la para página UP do Mercado Livre (/up/MLBU...)', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(301, {
        location:
          'https://www.mercadolivre.com.br/up/MLBU5730789416?matt_tool=38524122&pdp_filters=item_id%3AMLB7901946500#origin=share&sid=share&wid=MLB7901946500',
      }),
    );
    const out = await resolveShortLinks('Oferta: https://meli.la/2ZyJEM4', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.get('https://meli.la/2ZyJEM4')).toBe(
      'https://www.mercadolivre.com.br/up/MLBU5730789416?matt_tool=38524122&pdp_filters=item_id%3AMLB7901946500#origin=share&sid=share&wid=MLB7901946500',
    );
  });

  it('expande tidd.ly (encurtador da Awin)', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(301, { location: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2' }),
    );
    const out = await resolveShortLinks('Link: https://tidd.ly/4z61lcI', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.get('https://tidd.ly/4z61lcI')).toContain('awin1.com');
  });

  it('host fora da allowlist não gera requisição alguma', async () => {
    const fetchMock = vi.fn();
    const out = await resolveShortLinks('link https://bit.ly/xyz aqui', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texto sem nenhuma URL não gera requisição', async () => {
    const fetchMock = vi.fn();
    const out = await resolveShortLinks('sem link nenhum aqui', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('para de seguir ao estourar o máximo de saltos', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return fakeResponse(302, { location: `https://amzn.to/loop${calls}` });
    });
    const out = await resolveShortLinks('https://amzn.to/loop0', {
      fetch: fetchMock as unknown as typeof fetch,
      maxHops: 3,
    });
    expect(out.has('https://amzn.to/loop0')).toBe(false);
    expect(calls).toBe(3);
  });

  it('timeout resulta em falha da resolução daquele link, sem derrubar os demais', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      if (url === 'https://amzn.to/slow') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return fakeResponse(302, { location: 'https://www.amazon.com.br/dp/B0AAAAAAAA' });
    });
    const out = await resolveShortLinks('https://amzn.to/slow e https://a.co/OK1', {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(out.has('https://amzn.to/slow')).toBe(false);
    expect(out.get('https://a.co/OK1')).toBe('https://www.amazon.com.br/dp/B0AAAAAAAA');
  });

  it('rejeita salto para http', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(302, { location: 'http://amazon.com.br/dp/B0X' }),
    );
    const out = await resolveShortLinks('https://amzn.to/insecure', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.has('https://amzn.to/insecure')).toBe(false);
  });

  it('rejeita salto para IP literal / host privado', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(302, { location: 'https://127.0.0.1/admin' }));
    const out = await resolveShortLinks('https://amzn.to/ssrf', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.has('https://amzn.to/ssrf')).toBe(false);
  });

  it('usa a mesma extração do core: pontuação final não entra na URL requisitada', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200));
    await resolveShortLinks('Link: https://meli.la/1h21Ywb.', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://meli.la/1h21Ywb', expect.anything());
  });
});
