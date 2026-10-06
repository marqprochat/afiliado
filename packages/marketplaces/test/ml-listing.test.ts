import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMlListingUrl,
  cleanMlProductUrl,
  endOfDaySaoPaulo,
  isMlVerificationPage,
  parseMlListingHtml,
} from '../src';
import { CATALOG_HREF, listingPage, polyCard } from './helpers/ml-listing-html';

const NOW = new Date('2026-10-05T15:00:00.000Z');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('endOfDaySaoPaulo', () => {
  it('devolve 23:59:59 em São Paulo como ISO UTC', () => {
    expect(endOfDaySaoPaulo(NOW)).toBe('2026-10-06T02:59:59.000Z');
    expect(endOfDaySaoPaulo(new Date('2026-10-06T01:00:00.000Z'))).toBe('2026-10-06T02:59:59.000Z');
  });
});

describe('buildMlListingUrl', () => {
  it('monta as quatro fontes e a paginação', () => {
    expect(buildMlListingUrl({ kind: 'deals' }, 1)).toBe('https://www.mercadolivre.com.br/ofertas');
    expect(buildMlListingUrl({ kind: 'deals' }, 2)).toBe(
      'https://www.mercadolivre.com.br/ofertas?page=2',
    );
    expect(buildMlListingUrl({ kind: 'lightning' }, 1)).toBe(
      'https://www.mercadolivre.com.br/ofertas?promotion_type=lightning',
    );
    expect(buildMlListingUrl({ kind: 'category', categoryId: 'MLB1051' }, 3)).toBe(
      'https://www.mercadolivre.com.br/ofertas?category=MLB1051&page=3',
    );
    expect(
      buildMlListingUrl(
        { kind: 'url', url: 'https://www.mercadolivre.com.br/mais-vendidos#frag' },
        2,
      ),
    ).toBe('https://www.mercadolivre.com.br/mais-vendidos?page=2');
  });

  it('rejeita categoria inválida e URL fora do domínio do ML', () => {
    const invalid = (fn: () => unknown) =>
      expect(thrown(fn)).toMatchObject({ code: 'ML_LISTING_INVALID_URL' });
    invalid(() => buildMlListingUrl({ kind: 'category', categoryId: 'abc' }, 1));
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'http://www.mercadolivre.com.br/x' }, 1));
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'https://evil.com/ofertas' }, 1));
    invalid(() =>
      buildMlListingUrl({ kind: 'url', url: 'https://mercadolivre.com.br.evil.com/x' }, 1),
    );
    invalid(() => buildMlListingUrl({ kind: 'url', url: 'não é url' }, 1));
    expect(
      buildMlListingUrl({ kind: 'url', url: 'https://lista.mercadolivre.com.br/fone' }, 1),
    ).toBe('https://lista.mercadolivre.com.br/fone');
  });
});

describe('cleanMlProductUrl', () => {
  it('tira query e fragmento; preserva o wid em link de catálogo', () => {
    expect(cleanMlProductUrl(CATALOG_HREF.replace(/&amp;/g, '&'))).toBe(
      'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402#wid=MLB4083441037',
    );
    expect(
      cleanMlProductUrl(
        'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-_JM?searchVariation=1#polycard_client=offers&wid=MLB1',
      ),
    ).toBe('https://produto.mercadolivre.com.br/MLB-5421116792-tenis-_JM');
  });

  it('descarta patrocinado (click1), domínio de terceiros e lixo', () => {
    expect(cleanMlProductUrl('https://click1.mercadolivre.com.br/mclics/x?a=1')).toBeUndefined();
    expect(cleanMlProductUrl('https://evil.com/p/MLB1')).toBeUndefined();
    expect(cleanMlProductUrl('')).toBeUndefined();
  });
});

describe('isMlVerificationPage', () => {
  it('detecta pela URL final ou pelo HTML sem cards', () => {
    expect(
      isMlVerificationPage('https://www.mercadolivre.com.br/gz/account-verification?go=x', ''),
    ).toBe(true);
    expect(
      isMlVerificationPage(
        'https://www.mercadolivre.com.br/ofertas',
        '<link href=".../suspicious-traffic-frontend/gz-account-verification-index.css">',
      ),
    ).toBe(true);
    expect(isMlVerificationPage('https://www.mercadolivre.com.br/ofertas', polyCard())).toBe(false);
    expect(isMlVerificationPage('https://www.mercadolivre.com.br/ofertas', '<html></html>')).toBe(
      false,
    );
  });
});

describe('parseMlListingHtml: poly-card', () => {
  it('lê um card de catálogo com preço riscado, Pix, Full e wid', () => {
    const html = listingPage([
      polyCard({
        prev: '659',
        cur: ['183', '08'],
        discount: '72% OFF',
        note: 'no Pix',
        shipping: 'Chegará grátis amanhã',
        full: true,
      }),
    ]);
    expect(parseMlListingHtml(html, NOW)).toEqual([
      {
        source: 'MERCADOLIVRE',
        externalId: 'MLB46202402',
        title: 'Smartwatch Huawei Band 10',
        price: 183.08,
        originalPrice: 659,
        discountPct: 72,
        images: ['https://http2.mlstatic.com/D_Q_NP_2X_772291-MLA100008466405_122025-AB.webp'],
        shipping: 'FULL',
        originalUrl:
          'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402#wid=MLB4083441037',
        raw: { origin: 'ml-listing', priceNote: 'no Pix', freeShipping: true },
      },
    ]);
  });

  it('card Full: marca raw.freeShipping só quando o texto diz grátis', () => {
    const html = listingPage([
      polyCard({ shipping: 'Chegará grátis amanhã', full: true }),
      polyCard({
        href: 'https://www.mercadolivre.com.br/outro/p/MLB900',
        shipping: 'Chegará amanhã',
        full: true,
      }),
    ]);
    const [a, b] = parseMlListingHtml(html, NOW);
    expect(a).toMatchObject({ shipping: 'FULL', raw: { freeShipping: true } });
    expect(b?.shipping).toBe('FULL');
    expect(b?.raw).not.toHaveProperty('freeShipping');
  });

  it('lê anúncio individual sem preço riscado e com frete grátis', () => {
    const html = listingPage([
      polyCard({
        title: 'Tênis Sapatênis Masculino',
        href: 'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-sapatenis-_JM?searchVariation=188287640099#polycard_client=offers&amp;position=2',
        cur: ['1.299', '90'],
        shipping: 'Frete grátis',
      }),
    ]);
    const [p] = parseMlListingHtml(html, NOW);
    expect(p).toMatchObject({
      externalId: 'MLB5421116792',
      title: 'Tênis Sapatênis Masculino',
      price: 1299.9,
      shipping: 'FREE',
      originalUrl: 'https://produto.mercadolivre.com.br/MLB-5421116792-tenis-sapatenis-_JM',
    });
    expect(p?.originalPrice).toBeUndefined();
    expect(p?.discountPct).toBeUndefined();
  });

  it('calcula o desconto quando o rótulo não existe e ignora riscado <= atual', () => {
    const html = listingPage([
      polyCard({ prev: '200', cur: ['150'] }),
      polyCard({
        title: 'Outro',
        href: 'https://www.mercadolivre.com.br/outro/p/MLB900',
        prev: '100',
        cur: ['150'],
      }),
    ]);
    const [a, b] = parseMlListingHtml(html, NOW);
    expect(a).toMatchObject({ price: 150, originalPrice: 200, discountPct: 25 });
    expect(b?.originalPrice).toBeUndefined();
  });

  it('descarta patrocinado, sem imagem, sem preço e sem título; deduplica', () => {
    const sponsored = polyCard({
      title: 'Patrocinado',
      href: 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=x',
    });
    const noImage = polyCard({
      title: 'Sem imagem',
      image: '',
      href: 'https://www.mercadolivre.com.br/a/p/MLB1',
    });
    const noTitle = polyCard({ title: '', href: 'https://www.mercadolivre.com.br/b/p/MLB2' });
    const ok = polyCard({ prev: '300', cur: ['199'] });
    const html = listingPage([sponsored, noImage, noTitle, ok, ok]);
    const products = parseMlListingHtml(html, NOW);
    expect(products).toHaveLength(1);
    expect(products[0]?.externalId).toBe('MLB46202402');
  });

  it('associa o period_end de cada card com contagem, na ordem', () => {
    const html = listingPage(
      [
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/a/p/MLB11' }),
        polyCard({ href: 'https://www.mercadolivre.com.br/b/p/MLB22' }),
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/c/p/MLB33' }),
      ],
      ['2026-10-05T15:00:00Z', '2026-10-05T14:59:59Z'],
    );
    const [a, b, c] = parseMlListingHtml(html, NOW);
    expect(a?.flashSaleEndsAt).toBe('2026-10-05T15:00:00.000Z');
    expect(b?.flashSaleEndsAt).toBeUndefined();
    expect(c?.flashSaleEndsAt).toBe('2026-10-05T14:59:59.000Z');
  });

  it('usa o fim do dia em São Paulo quando as contagens não batem com o JSON', () => {
    const html = listingPage(
      [
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/a/p/MLB11' }),
        polyCard({ countdown: true, href: 'https://www.mercadolivre.com.br/c/p/MLB33' }),
      ],
      ['2026-10-05T15:00:00Z'],
    );
    const products = parseMlListingHtml(html, NOW);
    expect(products.map((p) => p.flashSaleEndsAt)).toEqual([
      '2026-10-06T02:59:59.000Z',
      '2026-10-06T02:59:59.000Z',
    ]);
  });
});

describe('parseMlListingHtml: carrossel', () => {
  it('lê o layout dynamic-carousel', () => {
    const html =
      '<html><body><div class="dynamic-carousel__item-container">' +
      '<a class="splinter-link" href="https://www.mercadolivre.com.br/p/MLB777">' +
      '<img src="https://http2.mlstatic.com/D_1.webp">' +
      '<h3 class="dynamic-carousel__title">Fone Bluetooth</h3>' +
      '<span class="dynamic-carousel__oldprice">R$ 1.299</span>' +
      '<span class="dynamic-carousel__price"><span>899</span><sup class="dynamic-carousel__price-decimals">90</sup></span>' +
      '<sup class="dynamic-carousel__discount">30% OFF</sup>' +
      '</a></div></body></html>';
    expect(parseMlListingHtml(html, NOW)).toEqual([
      {
        source: 'MERCADOLIVRE',
        externalId: 'MLB777',
        title: 'Fone Bluetooth',
        price: 899.9,
        originalPrice: 1299,
        discountPct: 30,
        images: ['https://http2.mlstatic.com/D_1.webp'],
        shipping: 'UNKNOWN',
        originalUrl: 'https://www.mercadolivre.com.br/p/MLB777',
        raw: { origin: 'ml-listing' },
      },
    ]);
  });
});

describe('parseMlListingHtml: fixture real', () => {
  it('lê cards reais de /ofertas com os invariantes esperados', () => {
    const html = readFileSync(
      new URL('./fixtures/ml-listing-ofertas.html', import.meta.url),
      'utf8',
    );
    const cardCount = (html.match(/class="andes-card poly-card /g) ?? []).length;
    const countdownCount = (html.match(/class="poly-component__highlight-countdown /g) ?? [])
      .length;
    const products = parseMlListingHtml(html, NOW);

    expect(cardCount).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThanOrEqual(Math.floor(cardCount * 0.8));
    for (const p of products) {
      expect(p.source).toBe('MERCADOLIVRE');
      expect(p.externalId).toMatch(/^MLB\d+$/);
      expect(p.price).toBeGreaterThan(0);
      expect(p.images[0]).toMatch(/^https:\/\//);
      expect(p.originalUrl).toMatch(/^https:\/\/[^?#]+(#wid=MLB\d+)?$/);
      if (p.originalPrice !== undefined) expect(p.originalPrice).toBeGreaterThan(p.price);
      if (p.discountPct !== undefined) {
        expect(p.discountPct).toBeGreaterThan(0);
        expect(p.discountPct).toBeLessThan(100);
      }
    }
    const flash = products.filter((p) => p.flashSaleEndsAt);
    expect(flash.length).toBeLessThanOrEqual(countdownCount);
    for (const p of flash) expect(Number.isNaN(Date.parse(p.flashSaleEndsAt!))).toBe(false);
  });

  it('o parser não acha cards na página de verificação', () => {
    expect(parseMlListingHtml('<html><body>suspicious-traffic</body></html>', NOW)).toEqual([]);
  });
});
