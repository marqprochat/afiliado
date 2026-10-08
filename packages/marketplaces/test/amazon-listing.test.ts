import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AmazonListingError,
  buildAmazonListingUrl,
  fetchAmazonListing,
  isAmazonBlockedPage,
  parseAmazonListingHtml,
  parseAmazonMegaHtml,
  parseAmazonSearchHtml,
} from '../src';

const searchHtml = readFileSync(new URL('./fixtures/amz-search.html', import.meta.url), 'utf8');
const megaHtml = readFileSync(new URL('./fixtures/amz-mega.html', import.meta.url), 'utf8');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('buildAmazonListingUrl', () => {
  it('monta a busca no departamento Ofertas com paginação', () => {
    expect(buildAmazonListingUrl({ kind: 'deals', query: 'celular' }, 1)).toBe(
      'https://www.amazon.com.br/s?k=celular&i=pbdd',
    );
    expect(buildAmazonListingUrl({ kind: 'deals', query: ' fone bluetooth ' }, 2)).toBe(
      'https://www.amazon.com.br/s?k=fone+bluetooth&i=pbdd&page=2',
    );
  });

  it('a Mega Oferta Prime não pagina', () => {
    expect(buildAmazonListingUrl({ kind: 'mega' }, 1)).toBe(
      'https://www.amazon.com.br/megaofertaprime',
    );
    expect(buildAmazonListingUrl({ kind: 'mega' }, 3)).toBe(
      'https://www.amazon.com.br/megaofertaprime',
    );
  });

  it('rejeita palavra-chave vazia e não deixa o termo escapar da query', () => {
    expect(thrown(() => buildAmazonListingUrl({ kind: 'deals', query: '  ' }, 1))).toMatchObject({
      code: 'AMAZON_LISTING_INVALID_QUERY',
    });
    const url = buildAmazonListingUrl({ kind: 'deals', query: 'a&i=aps#x' }, 1);
    expect(new URL(url).searchParams.get('k')).toBe('a&i=aps#x');
    expect(new URL(url).searchParams.get('i')).toBe('pbdd');
  });
});

describe('parseAmazonSearchHtml (fixture real)', () => {
  const products = parseAmazonSearchHtml(searchHtml);

  it('lê ASIN, título, imagem, preço, riscado e desconto de cada card', () => {
    expect(products.length).toBeGreaterThanOrEqual(3);
    for (const p of products) {
      expect(p.source).toBe('AMAZON');
      expect(p.externalId).toMatch(/^[A-Z0-9]{10}$/);
      expect(p.originalUrl).toBe(`https://www.amazon.com.br/dp/${p.externalId}`);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.images[0]).toMatch(/^https:\/\//);
      expect(p.price).toBeGreaterThan(0);
      if (p.originalPrice !== undefined) {
        expect(p.originalPrice).toBeGreaterThan(p.price);
        expect(p.discountPct).toBe(
          Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100),
        );
      }
    }
    expect(products.some((p) => p.originalPrice !== undefined)).toBe(true);
  });

  it('marca patrocinado e frete grátis em raw sem descartar o produto', () => {
    const raws = products.map((p) => p.raw as { sponsored?: boolean; freeShipping?: boolean });
    expect(raws.some((r) => r.sponsored)).toBe(true);
    const free = products.find((p) => (p.raw as { freeShipping?: boolean }).freeShipping);
    if (free) expect(free.shipping).toBe('FREE');
  });

  it('converte "R$ 1.798,95" em número', () => {
    expect(products.some((p) => p.price === 1798.95)).toBe(true);
  });
});

// Card com selo "N% off" e "Mega Oferta Prime", como a vitrine serviu em 08/10/2026 (a fixture
// capturada nesse mesmo dia só tem cards de livros, sem selo e com o alt da imagem vazio).
const MEGA_BADGE_CARD = `<ul><li class="a-carousel-card dcl-carousel-element"><div class="dcl-product-wrapper" data-csa-c-item-id="amzn1.asin.B0C9R8RC1P:amzn1.deal.a851d25f"><div class="a-cardui dcl-product"><a class="a-link-normal dcl-product-link" href="/Pilha-AAA-Pequena-24-Unidades/dp/B0C9R8RC1P?ref_=x"><div class="dcl-product-image-container"><img alt="Duracell Pilhas Alcalinas AAA Pack 24" src="https://m.media-amazon.com/images/I/51Lh9KIVXqL._AC_SR240,220_.jpg"/></div><div class="a-section dcl-product-detail"><div class="a-section dcl-badge"><div><div><span class="a-size-mini">20% off</span></div><div><span class="a-size-mini">Mega Oferta Prime</span></div></div></div><div class="dcl-price-single"><span class="a-price dcl-product-price-new"><span class="a-offscreen">R$ 99,64</span></span><div class="a-section dcl-product-old-price-section"><span class="a-price a-text-price dcl-product-price-old"><span class="a-offscreen">R$ 124,90</span></span></div></div></div></a></div></div></li></ul>`;

describe('parseAmazonMegaHtml', () => {
  it('lê o card com o "% off" e o selo', () => {
    expect(parseAmazonMegaHtml(MEGA_BADGE_CARD)).toEqual([
      expect.objectContaining({
        externalId: 'B0C9R8RC1P',
        title: 'Duracell Pilhas Alcalinas AAA Pack 24',
        price: 99.64,
        originalPrice: 124.9,
        discountPct: 20,
        originalUrl: 'https://www.amazon.com.br/dp/B0C9R8RC1P',
        raw: { origin: 'amazon-listing', badge: 'Mega Oferta Prime' },
      }),
    ]);
  });

  it('fixture real: título pelo slug quando o alt é vazio e desconto calculado sem selo', () => {
    const products = parseAmazonMegaHtml(megaHtml);
    expect(products).toHaveLength(6);
    expect(products[0]).toMatchObject({
      externalId: '8501923281',
      title: 'Nunca minta Freida McFadden',
      price: 33.84,
      originalPrice: 59.9,
      discountPct: 44,
    });
    for (const p of products) expect(p.originalPrice).toBeGreaterThan(p.price);
  });

  it('descarta card sem preço', () => {
    const noPrice = MEGA_BADGE_CARD.replace(
      /<span class="a-price dcl-product-price-new">.*?<\/span><\/span>/,
      '',
    );
    expect(parseAmazonMegaHtml(noPrice)).toEqual([]);
  });
});

describe('parseAmazonListingHtml', () => {
  it('deduplica por ASIN', () => {
    const once = parseAmazonListingHtml({ kind: 'mega' }, megaHtml);
    const twice = parseAmazonListingHtml({ kind: 'mega' }, megaHtml + megaHtml);
    expect(twice).toHaveLength(once.length);
  });
});

describe('isAmazonBlockedPage', () => {
  it('reconhece o captcha e não confunde com uma listagem', () => {
    expect(
      isAmazonBlockedPage('<form action="/errors/validateCaptcha">Digite os caracteres</form>'),
    ).toBe(true);
    expect(isAmazonBlockedPage(searchHtml)).toBe(false);
  });
});

function response(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('fetchAmazonListing', () => {
  const sleep = vi.fn(async () => {});
  // ASIN diferente por página, para a paginação não parar por "repetiu a mesma página"
  const pageN = (n: number) =>
    searchHtml.replaceAll(/data-asin="([A-Z0-9]{9})[A-Z0-9]"/g, `data-asin="$1${n}"`);

  it('pagina até juntar o limite, pedindo cada página sem cookies', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>).Cookie).toBeUndefined();
      return response(pageN(calls.length));
    }) as unknown as typeof fetch;
    const out = await fetchAmazonListing(
      { kind: 'deals', query: 'celular' },
      { limit: 5, fetchImpl, sleep },
    );
    expect(out).toHaveLength(5);
    expect(calls[0]).toContain('i=pbdd');
    expect(calls[1]).toContain('page=2');
  });

  it('a Mega Oferta Prime lê uma página só', async () => {
    const fetchImpl = vi.fn(async () => response(megaHtml)) as unknown as typeof fetch;
    const out = await fetchAmazonListing({ kind: 'mega' }, { limit: 500, fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(6);
  });

  it('aplica o filtro durante a paginação', async () => {
    const fetchImpl = vi.fn(async () => response(megaHtml)) as unknown as typeof fetch;
    const out = await fetchAmazonListing(
      { kind: 'mega' },
      { limit: 10, fetchImpl, sleep, filter: (p) => p.externalId === '8535946039' },
    );
    expect(out.map((p) => p.externalId)).toEqual(['8535946039']);
  });

  it('repete com os cookies quando a página anônima vem como casca', async () => {
    const seen: (string | undefined)[] = [];
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const cookie = (init?.headers as Record<string, string>).Cookie;
      seen.push(cookie);
      return response(cookie ? searchHtml : '<html><head></head></html>');
    }) as unknown as typeof fetch;
    const out = await fetchAmazonListing(
      { kind: 'deals', query: 'celular' },
      { limit: 2, fetchImpl, sleep, cookies: { 'session-id': 'abc' }, maxPages: 1 },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(seen).toEqual([undefined, 'session-id=abc']);
  });

  it('BLOCKED na página 1 sem sessão e com sessão (mensagens diferentes)', async () => {
    const shell = vi.fn(async () => response('<html></html>')) as unknown as typeof fetch;
    const semSessao = await fetchAmazonListing(
      { kind: 'deals', query: 'x' },
      { limit: 5, fetchImpl: shell, sleep },
    ).catch((e: unknown) => e);
    expect(semSessao).toBeInstanceOf(AmazonListingError);
    expect(semSessao).toMatchObject({ code: 'AMAZON_LISTING_BLOCKED' });
    expect((semSessao as Error).message).toContain('não há sessão');

    const comSessao = await fetchAmazonListing(
      { kind: 'deals', query: 'x' },
      { limit: 5, fetchImpl: shell, sleep, cookies: { a: 'b' } },
    ).catch((e: unknown) => e);
    expect(comSessao).toMatchObject({ code: 'AMAZON_LISTING_BLOCKED' });
    expect((comSessao as Error).message).toContain('pode ter expirado');
  });

  it('503 e 429 contam como bloqueio; outro HTTP de erro vira AMAZON_LISTING_HTTP', async () => {
    const status = (s: number) => vi.fn(async () => response('x', s)) as unknown as typeof fetch;
    await expect(
      fetchAmazonListing({ kind: 'mega' }, { limit: 5, fetchImpl: status(503), sleep }),
    ).rejects.toMatchObject({ code: 'AMAZON_LISTING_BLOCKED' });
    await expect(
      fetchAmazonListing({ kind: 'mega' }, { limit: 5, fetchImpl: status(429), sleep }),
    ).rejects.toMatchObject({ code: 'AMAZON_LISTING_BLOCKED' });
    await expect(
      fetchAmazonListing({ kind: 'mega' }, { limit: 5, fetchImpl: status(500), sleep }),
    ).rejects.toMatchObject({ code: 'AMAZON_LISTING_HTTP' });
  });

  it('LAYOUT quando há cards mas nenhum foi reconhecido', async () => {
    const html =
      '<div data-component-type="s-search-result" data-asin="B000000000"><span>sem preço</span></div>';
    const fetchImpl = vi.fn(async () => response(html)) as unknown as typeof fetch;
    await expect(
      fetchAmazonListing({ kind: 'deals', query: 'x' }, { limit: 5, fetchImpl, sleep }),
    ).rejects.toMatchObject({ code: 'AMAZON_LISTING_LAYOUT' });
  });

  it('falha na página 2 devolve o que veio na página 1', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n === 1 ? response(searchHtml) : response('boom', 500);
    }) as unknown as typeof fetch;
    const out = await fetchAmazonListing(
      { kind: 'deals', query: 'celular' },
      { limit: 100, fetchImpl, sleep },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(n).toBe(2);
  });

  it('palavra-chave vazia falha antes de qualquer requisição', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      fetchAmazonListing({ kind: 'deals', query: ' ' }, { limit: 5, fetchImpl, sleep }),
    ).rejects.toMatchObject({ code: 'AMAZON_LISTING_INVALID_QUERY' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
