import { describe, expect, it, vi } from 'vitest';
import { fetchMlListing, MlListingError } from '../src';
import { listingPage, polyCard } from './helpers/ml-listing-html';

function cards(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return polyCard({
      title: `Produto ${id}`,
      href: `https://www.mercadolivre.com.br/produto-${id}/p/MLB${1000 + id}`,
      prev: '300',
      cur: ['150'],
      discount: '50% OFF',
    });
  });
}

function resp(html: string, o: { status?: number; url?: string } = {}) {
  return {
    ok: (o.status ?? 200) < 400,
    status: o.status ?? 200,
    url: o.url ?? 'https://www.mercadolivre.com.br/ofertas',
    text: async () => html,
  } as unknown as Response;
}

const blocked = () =>
  resp('<html>suspicious-traffic</html>', {
    url: 'https://www.mercadolivre.com.br/gz/account-verification?go=x',
  });

const noSleep = async () => {};

describe('fetchMlListing', () => {
  it('pagina até juntar o limite e pausa entre páginas', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3, 1))))
      .mockResolvedValueOnce(resp(listingPage(cards(3, 4))));
    const sleep = vi.fn(async () => {});
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 5, fetchImpl: fetchImpl as unknown as typeof fetch, sleep },
    );
    expect(out).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://www.mercadolivre.com.br/ofertas?page=2');
    expect(sleep).toHaveBeenCalledTimes(1);
    const ms = (sleep.mock.calls[0] as unknown as [number])[0];
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(2000);
  });

  it('para no teto de 5 páginas mesmo com limite maior', async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => resp(listingPage(cards(2, 1 + page++ * 2))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 500, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(out).toHaveLength(10);
  });

  it('aplica o filtro durante a paginação e segue buscando até juntar o limite', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3, 1))))
      .mockResolvedValueOnce(resp(listingPage(cards(3, 4))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      {
        limit: 2,
        // só os ids pares passam
        filter: (p) => Number(p.title.replace('Produto ', '')) % 2 === 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      },
    );
    expect(out.map((p) => p.title)).toEqual(['Produto 2', 'Produto 4']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('para quando a página repete o que já veio', async () => {
    const same = resp(listingPage(cards(3, 1)));
    const fetchImpl = vi.fn(async () => same);
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 100, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(out).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('repete a página com os cookies da sessão quando cai na verificação', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(blocked())
      .mockResolvedValueOnce(resp(listingPage(cards(2))));
    const out = await fetchMlListing(
      { kind: 'deals' },
      {
        limit: 10,
        cookies: { ssid: 'abc', orguseridp: '1' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      },
    );
    expect(out).toHaveLength(2);
    const first = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const second = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect((first.headers as Record<string, string>).Cookie).toBeUndefined();
    expect((second.headers as Record<string, string>).Cookie).toBe('ssid=abc; orguseridp=1');
  });

  it('ML_LISTING_BLOCKED sem cookies e com cookies que não adiantam', async () => {
    const run = (cookies: Record<string, string> | undefined, impl: ReturnType<typeof vi.fn>) =>
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          ...(cookies ? { cookies } : {}),
          fetchImpl: impl as unknown as typeof fetch,
          sleep: noSleep,
        },
      );
    const anon = vi.fn(async () => blocked());
    const anonErr = await run(undefined, anon).catch((e: unknown) => e);
    expect(anonErr).toBeInstanceOf(MlListingError);
    expect(anonErr).toMatchObject({ code: 'ML_LISTING_BLOCKED' });
    expect((anonErr as MlListingError).message).toMatch(/não há sessão sincronizada/);
    expect(anon).toHaveBeenCalledTimes(1);

    const withCookies = vi.fn(async () => blocked());
    const err = await run({ a: '1' }, withCookies).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlListingError);
    expect(err).toMatchObject({ code: 'ML_LISTING_BLOCKED' });
    expect((err as MlListingError).message).toMatch(/mesmo com a sessão sincronizada/);
    expect(withCookies).toHaveBeenCalledTimes(2);
    const second = withCookies.mock.calls[1] as unknown as [string, RequestInit];
    expect((second[1].headers as Record<string, string>).Cookie).toBe('a=1');
  });

  it('trata 403 como bloqueio', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => resp('', { status: 403 })) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_BLOCKED' });
  });

  it('falha de rede na página 1 vira ML_LISTING_HTTP em português, sem vazar o cookie', async () => {
    const err = await fetchMlListing(
      { kind: 'deals' },
      {
        limit: 10,
        cookies: { ssid: 'segredo-123' },
        fetchImpl: vi.fn(async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
        sleep: noSleep,
      },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlListingError);
    expect(err).toMatchObject({ code: 'ML_LISTING_HTTP' });
    const e = err as MlListingError;
    expect(e.message).toMatch(/rede|tempo/i);
    expect(`${e.message} ${e.details ?? ''}`).not.toContain('segredo-123');
  });

  it('timeout (AbortError) na página 1 vira ML_LISTING_HTTP', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => {
            throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
          }) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ML_LISTING_HTTP',
      message: expect.stringMatching(/rede|tempo/i),
    });
  });

  it('falha de rede na página 2 devolve o que veio na página 1', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3))))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 100, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(out).toHaveLength(3);
  });

  it('trata 429 como bloqueio', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => resp('', { status: 429 })) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_BLOCKED' });
  });

  it('ML_LISTING_LAYOUT quando a página 1 vem sem nenhum card reconhecido', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () =>
            resp('<html><body><div class="novo-layout">…</div></body></html>'),
          ) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_LAYOUT' });
  });

  it('ML_LISTING_HTTP em erro HTTP na página 1', async () => {
    await expect(
      fetchMlListing(
        { kind: 'deals' },
        {
          limit: 10,
          fetchImpl: vi.fn(async () => resp('', { status: 500 })) as unknown as typeof fetch,
          sleep: noSleep,
        },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_HTTP' });
  });

  it('falha na página 2 devolve o que veio na página 1', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(listingPage(cards(3))))
      .mockResolvedValueOnce(resp('', { status: 500 }));
    const out = await fetchMlListing(
      { kind: 'deals' },
      { limit: 100, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
    );
    expect(out).toHaveLength(3);
  });

  it('categoria inválida falha antes de qualquer requisição', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchMlListing(
        { kind: 'category', categoryId: 'abc' },
        { limit: 10, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'ML_LISTING_INVALID_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
