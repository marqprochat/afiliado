import { describe, expect, it } from 'vitest';
import { parseAmazonHtml, parseMagaluHtml, parseMercadoLivreHtml } from '../src';

describe('Scrapers de Marketplaces (Fase 3)', () => {
  it('Mercado Livre: extrai título, preços, desconto, imagem e selo Full', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Fritadeira Sem Óleo Air Fryer Mondial - Mercado Livre</title>
          <meta property="og:title" content="Fritadeira Sem Óleo Air Fryer Mondial AFN-40-BI 4L Preta 127V" />
          <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_2X_789123-MLA123456_012026-F.webp" />
        </head>
        <body>
          <h1 class="ui-pdp-title">Fritadeira Sem Óleo Air Fryer Mondial AFN-40-BI 4L Preta 127V</h1>
          <div class="ui-pdp-price__original-value">
            <span class="andes-money-amount__fraction">499</span>
            <span class="andes-money-amount__cents">90</span>
          </div>
          <div class="ui-pdp-price__second-line">
            <span class="andes-money-amount__fraction">299</span>
            <span class="andes-money-amount__cents">90</span>
            <span class="ui-pdp-price__discount">40% OFF</span>
          </div>
          <div class="ui-pdp-media__title">Frete grátis</div>
          <svg class="ui-pdp-icon--full"></svg>
          <div class="ui-pdp-promotions">Cupom: MONDIAL20</div>
        </body>
      </html>
    `;

    const product = parseMercadoLivreHtml(
      html,
      'https://produto.mercadolivre.com.br/MLB-3456789012-fritadeira-air-fryer-mondial.html',
    );

    expect(product.source).toBe('MERCADOLIVRE');
    expect(product.externalId).toBe('MLB3456789012');
    expect(product.title).toBe('Fritadeira Sem Óleo Air Fryer Mondial AFN-40-BI 4L Preta 127V');
    expect(product.price).toBe(299.9);
    expect(product.originalPrice).toBe(499.9);
    expect(product.discountPct).toBe(40);
    expect(product.shipping).toBe('FULL');
    expect(product.couponCode).toBe('MONDIAL20');
    expect(product.images).toHaveLength(1);
    expect(product.images[0]).toContain('http2.mlstatic.com');
  });

  it('Amazon: extrai título, preço, preço original, desconto, imagens e frete Prime', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Echo Dot 5ª Geração | Smart speaker com Alexa | Cor Preta</title>
        </head>
        <body>
          <span id="productTitle">Echo Dot 5ª Geração | Smart speaker com Alexa | Cor Preta</span>
          <div id="basisPrice">
            <span class="a-offscreen">R$ 429,00</span>
          </div>
          <div id="corePrice_feature_div">
            <span class="a-price"><span class="a-offscreen">R$ 299,00</span></span>
            <span class="savingPriceOverride">30% de desconto</span>
          </div>
          <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/71C3554ECnL._AC_SL1000_.jpg" />
          <i class="a-icon-prime"></i>
          <span id="couponText">Economize R$ 20,00 com cupom</span>
        </body>
      </html>
    `;

    const product = parseAmazonHtml(html, 'https://www.amazon.com.br/dp/B09B8V1LZ3');

    expect(product.source).toBe('AMAZON');
    expect(product.externalId).toBe('B09B8V1LZ3');
    expect(product.title).toBe('Echo Dot 5ª Geração | Smart speaker com Alexa | Cor Preta');
    expect(product.price).toBe(299.0);
    expect(product.originalPrice).toBe(429.0);
    expect(product.discountPct).toBe(30);
    expect(product.shipping).toBe('FREE');
    expect(product.couponCode).toBe('CUPOM AMAZON');
    expect(product.couponValue).toBe(20.0);
    expect(product.images[0]).toBe(
      'https://m.media-amazon.com/images/I/71C3554ECnL._AC_SL1000_.jpg',
    );
  });

  it('Magalu: extrai título, preço, preço original, desconto e imagens', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Smartphone Samsung Galaxy A55 5G 128GB - Magazine Luiza</title>
        </head>
        <body>
          <h1 data-testid="heading-product-title">Smartphone Samsung Galaxy A55 5G 128GB Azul Claro</h1>
          <span data-testid="price-original">R$ 2.999,00</span>
          <span data-testid="price-value">R$ 1.799,10</span>
          <span data-testid="price-discount">40% de desconto</span>
          <img data-testid="image-selected-thumbnail" src="https://a-static.mlcdn.com.br/800x560/smartphone-samsung-galaxy-a55.jpg" />
          <div data-testid="shipping-free">Frete grátis</div>
        </body>
      </html>
    `;

    const product = parseMagaluHtml(
      html,
      'https://www.magazineluiza.com.br/smartphone-samsung-galaxy-a55/p/237890100/te/s24u/',
    );

    expect(product.source).toBe('MAGALU');
    expect(product.externalId).toBe('237890100');
    expect(product.title).toBe('Smartphone Samsung Galaxy A55 5G 128GB Azul Claro');
    expect(product.price).toBe(1799.1);
    expect(product.originalPrice).toBe(2999.0);
    expect(product.discountPct).toBe(40);
    expect(product.shipping).toBe('FREE');
    expect(product.images[0]).toContain('mlcdn.com.br');
  });
});
