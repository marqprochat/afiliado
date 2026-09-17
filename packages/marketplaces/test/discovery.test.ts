import { describe, it, expect } from 'vitest';
import {
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
} from '../src/scrapers/discovery';

const AMAZON_SEARCH_HTML = `
<html><body>
  <div class="s-main-slot">
    <a href="/dp/B08N5WRWNW/ref=sr_1_1">Fone Bluetooth</a>
    <a href="/dp/B08N5WRWNW/ref=sr_1_1_variant">Mesmo produto, link duplicado</a>
    <a href="/gp/product/B07XJ8C8F5">Caixa de Som</a>
    <a href="/s?k=fone&page=2">Próxima página (não é produto)</a>
    <a href="https://www.amazon.com.br/ap/signin">Login (não é produto)</a>
  </div>
</body></html>`;

const ML_SEARCH_HTML = `
<html><body>
  <ol class="ui-search-layout">
    <li><a href="https://produto.mercadolivre.com.br/MLB-1234567890-fone-bluetooth-_JM">Fone Bluetooth</a></li>
    <li><a href="https://www.mercadolivre.com.br/fone-bluetooth/p/MLB1234567890">Mesmo produto (variante /p/)</a></li>
    <li><a href="https://www.mercadolivre.com.br/perfil/vendedor">Perfil do vendedor (não é produto)</a></li>
  </ol>
</body></html>`;

const MAGALU_SEARCH_HTML = `
<html><body>
  <div data-testid="product-list">
    <a href="https://www.magazineluiza.com.br/fone-bluetooth/p/ab12cd3efg/te/fone/">Fone Bluetooth</a>
    <a href="https://www.magazineluiza.com.br/busca/fone/?page=2">Próxima página (não é produto)</a>
  </div>
</body></html>`;

describe('discoverMercadoLivreByKeyword', () => {
  it('extrai URLs de produto únicas e descarta links de navegação', async () => {
    const urls = await discoverMercadoLivreByKeyword('fone', {
      fetchHtml: async () => ML_SEARCH_HTML,
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('MLB-1234567890');
  });
});

describe('discoverAmazonByKeyword', () => {
  it('extrai URLs de produto únicas (absolutas) e descarta paginação/login', async () => {
    const urls = await discoverAmazonByKeyword('fone', { fetchHtml: async () => AMAZON_SEARCH_HTML });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith('https://www.amazon.com.br'))).toBe(true);
  });
});

describe('discoverMagaluByKeyword', () => {
  it('extrai URLs de produto e descarta paginação', async () => {
    const urls = await discoverMagaluByKeyword('fone', { fetchHtml: async () => MAGALU_SEARCH_HTML });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/p/ab12cd3efg/');
  });
});
