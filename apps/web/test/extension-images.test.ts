import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

const CONTENT_JS_PATH = path.resolve(__dirname, '../../extension/content/content.js');
const CONTENT_JS = fs.readFileSync(CONTENT_JS_PATH, 'utf8');

function loadContentScript(url: string, html: string) {
  document.documentElement.innerHTML = html;
  const target = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: target.href,
      origin: target.origin,
      pathname: target.pathname,
      search: target.search,
      hostname: target.hostname,
      toString: () => target.href,
    },
    configurable: true,
    writable: true,
  });

  let messageHandler:
    | ((req: unknown, sender: unknown, sendResponse: (res: unknown) => void) => unknown)
    | null = null;

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener(fn: typeof messageHandler) {
          messageHandler = fn;
        },
      },
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
  };

  // Executa o content script no contexto jsdom atual
  const fn = new Function(CONTENT_JS);
  fn();

  return {
    getProductData(): { images: string[]; title?: string; price?: number } {
      let result: unknown;
      messageHandler?.({ action: 'GET_PRODUCT_DATA' }, {}, (res) => {
        result = res;
      });
      return (result as { product: { images: string[]; title?: string; price?: number } }).product;
    },
    async extractProducts(): Promise<
      Array<{ url: string; title?: string; price?: number; images?: string[] }>
    > {
      return new Promise((resolve) => {
        messageHandler?.({ action: 'EXTRACT_PRODUCTS' }, {}, (res) => {
          resolve(
            (res as { items: Array<{ url: string; title?: string; price?: number; images?: string[] }> })
              .items,
          );
        });
      });
    },
  };
}

describe('Extension content.js image extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Evita esperar 6 * 400ms no EXTRACT_PRODUCTS durante os testes
    window.scrollBy = () => {};
    window.scrollTo = () => {};
  });

  it('Magalu listing: unwraps /_next/image, skips badges/data: placeholders, and upgrades mlcdn to 1500x1500', async () => {
    const html = `
      <head><title>Busca Magalu</title></head>
      <body>
        <a href="/smartphone-samsung/p/238036600/te/galx/" data-testid="product-card-container">
          <img class="badge-full" src="https://a-static.mlcdn.com.br/50x50/selo-full.png" />
          <img
            data-testid="image"
            src="/_next/image?url=https%3A%2F%2Fa-static.mlcdn.com.br%2F200x200%2Fsamsung.jpg&w=64&q=10"
            srcset="/_next/image?url=https%3A%2F%2Fa-static.mlcdn.com.br%2F200x200%2Fsamsung.jpg&w=256&q=75 256w, /_next/image?url=https%3A%2F%2Fa-static.mlcdn.com.br%2F800x560%2Fsamsung.jpg&w=1080&q=75 1080w"
          />
          <h2 data-testid="product-title">Smartphone Samsung Galaxy</h2>
          <div data-testid="product-card-price-final">
            <span data-testid="price-value-integer">1.999</span>
            <span data-testid="price-value-split-cents-fraction">90</span>
          </div>
        </a>
        <a href="/geladeira-frost-free/p/123456789/ed/gel/" data-testid="product-card-container">
          <picture>
            <source srcset="https://a-static.mlcdn.com.br/280x210/geladeira.jpg 1x, https://a-static.mlcdn.com.br/560x420/geladeira.jpg 2x" />
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="https://a-static.mlcdn.com.br/280x210/geladeira.jpg" />
          </picture>
          <h2>Geladeira Frost Free</h2>
          <div data-testid="product-card-price-final">
            <span data-testid="price-value-integer">2.899</span>
            <span data-testid="price-value-split-cents-fraction">00</span>
          </div>
        </a>
      </body>
    `;
    const api = loadContentScript('https://www.magazineluiza.com.br/busca/samsung/', html);
    const items = await api.extractProducts();

    expect(items).toHaveLength(2);
    expect(items[0]?.images).toEqual(['https://a-static.mlcdn.com.br/1500x1500/samsung.jpg']);
    expect(items[1]?.images).toEqual(['https://a-static.mlcdn.com.br/1500x1500/geladeira.jpg']);
  });

  it('Amazon listing: ignores /images/G/ badges, swatches, and upgrades _AC_UL320_/_AC_SR160,160_ to _AC_SL1500_', async () => {
    const html = `
      <head><title>Busca Amazon</title></head>
      <body>
        <div data-component-type="s-search-result" data-asin="B0TEST0001" class="s-result-item">
          <img src="https://m.media-amazon.com/images/G/32/prime/badge.png" />
          <img src="https://m.media-amazon.com/images/I/transparent-pixel.gif" />
          <a href="/Echo-Dot/dp/B0TEST0001">
            <img
              class="s-image"
              src="https://m.media-amazon.com/images/I/71abcDEFgHL._AC_UL320_.jpg"
              srcset="https://m.media-amazon.com/images/I/71abcDEFgHL._AC_UL320_.jpg 1x, https://m.media-amazon.com/images/I/71abcDEFgHL._AC_UL640_QL65_.jpg 2x"
            />
          </a>
          <ul>
            <li data-asin="B0SWATCH01">
              <a href="/Echo-Dot-Branco/dp/B0SWATCH01">
                <img src="https://m.media-amazon.com/images/I/11swatch._SS40_.jpg" width="20" height="20" />
              </a>
            </li>
          </ul>
          <h2>Echo Dot 5ª Geração</h2>
          <span class="a-price"><span class="a-offscreen">R$ 349,00</span></span>
        </div>
        <div data-component-type="s-search-result" data-asin="B0TEST0002" class="s-result-item">
          <a href="/Pilha-Duracell/dp/B0TEST0002">
            <img
              class="s-image"
              src="https://m.media-amazon.com/images/I/51Lh9KIVXqL._AC_SR160,160_.jpg"
            />
          </a>
          <h2>Pilha Duracell</h2>
          <span class="a-price"><span class="a-offscreen">R$ 49,90</span></span>
        </div>
      </body>
    `;
    const api = loadContentScript('https://www.amazon.com.br/s?k=echo', html);
    const items = await api.extractProducts();

    expect(items).toHaveLength(2);
    expect(items[0]?.images).toEqual([
      'https://m.media-amazon.com/images/I/71abcDEFgHL._AC_SL1500_.jpg',
    ]);
    expect(items[1]?.images).toEqual([
      'https://m.media-amazon.com/images/I/51Lh9KIVXqL._AC_SL1500_.jpg',
    ]);
  });

  it('Amazon PDP: picks largest resolution from data-a-dynamic-image and upgrades it', () => {
    const html = `
      <head><title>Amazon PDP</title></head>
      <body>
        <h1 id="productTitle">Kindle 11ª Geração</h1>
        <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">R$ 499,00</span></span></div>
        <img
          id="landingImage"
          src="https://m.media-amazon.com/images/I/71kindle._AC_SX355_.jpg"
          data-a-dynamic-image='{"https://m.media-amazon.com/images/I/71kindle._AC_SX355_.jpg":[355,355],"https://m.media-amazon.com/images/I/71kindle._AC_SL1500_.jpg":[1500,1500]}'
        />
      </body>
    `;
    const api = loadContentScript('https://www.amazon.com.br/dp/B0KINDLE11', html);
    const product = api.getProductData();
    expect(product.images).toEqual([
      'https://m.media-amazon.com/images/I/71kindle._AC_SL1500_.jpg',
    ]);
  });

  it('Magalu PDP: handles wrapper div [data-testid="main-image"] and upgrades image to 1500x1500', () => {
    const html = `
      <head><title>Magalu PDP</title></head>
      <body>
        <h1 data-testid="heading-product-title">Smart TV 50</h1>
        <div data-testid="price-value">R$ 2.199,00</div>
        <div data-testid="main-image">
          <img src="https://a-static.mlcdn.com.br/800x560/smart-tv-50.jpg" />
        </div>
      </body>
    `;
    const api = loadContentScript(
      'https://www.magazineluiza.com.br/smart-tv-50/p/987654321/et/tv/',
      html,
    );
    const product = api.getProductData();
    expect(product.images).toEqual(['https://a-static.mlcdn.com.br/1500x1500/smart-tv-50.jpg']);
  });
});
