import { describe, it, expect } from 'vitest';
import { mapAwinRow, parseAwinPrice } from '../src/awin/mapper';

const awinFeed = { feedId: 'f1', advertiserId: '111', advertiserName: 'Loja X', format: 'Awin' as const };
const googleFeed = { feedId: 'f2', advertiserId: '222', advertiserName: 'Loja Y', format: 'Google' as const };

describe('parseAwinPrice', () => {
  it('extrai o primeiro número da string', () => {
    expect(parseAwinPrice('99.90')).toBe(99.9);
    expect(parseAwinPrice('129.90 BRL')).toBe(129.9);
  });
  it('remove separador de milhar', () => {
    expect(parseAwinPrice('1,299.00 BRL')).toBe(1299);
  });
  it('retorna null para vazio/indefinido/não numérico', () => {
    expect(parseAwinPrice(undefined)).toBeNull();
    expect(parseAwinPrice('')).toBeNull();
    expect(parseAwinPrice('BRL')).toBeNull();
  });
});

describe('mapAwinRow — formato Awin', () => {
  it('mapeia uma linha completa do CSV', () => {
    const row = {
      aw_product_id: 'p1',
      aw_deep_link: 'https://www.awin1.com/pclick.php?p=1&a=2&m=3',
      product_name: 'Fone Bluetooth',
      search_price: '99.90',
      rrp_price: '129.90 BRL',
      merchant_image_url: 'https://x/img.png',
      in_stock: '1',
      is_for_sale: '1',
    };
    expect(mapAwinRow(row, awinFeed)).toEqual({
      feedId: 'f1',
      advertiserId: '111',
      advertiserName: 'Loja X',
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/pclick.php?p=1&a=2&m=3',
      raw: { format: 'Awin', brand: null, category: null },
    });
  });

  it('usa aw_image_url quando merchant_image_url falta', () => {
    const row = {
      aw_product_id: 'p1',
      aw_deep_link: 'https://x',
      product_name: 'n',
      search_price: '10',
      aw_image_url: 'https://x/aw.png',
    };
    expect(mapAwinRow(row, awinFeed)?.imageUrl).toBe('https://x/aw.png');
  });

  it('usa product_price_old quando rrp_price falta e é maior que o preço', () => {
    const row = {
      aw_product_id: 'p1',
      aw_deep_link: 'https://x',
      product_name: 'n',
      search_price: '10',
      product_price_old: '15',
    };
    expect(mapAwinRow(row, awinFeed)?.originalPrice).toBe(15);
  });

  it('ignora rrp_price quando não é maior que o preço atual', () => {
    const row = {
      aw_product_id: 'p2',
      aw_deep_link: 'https://www.awin1.com/pclick.php?x',
      product_name: 'Caneca',
      search_price: '20.00',
      rrp_price: '15.00',
    };
    expect(mapAwinRow(row, awinFeed)?.originalPrice).toBeNull();
  });

  it('retorna null quando falta um campo obrigatório ou preço não numérico', () => {
    expect(mapAwinRow({ aw_product_id: 'p3' }, awinFeed)).toBeNull();
    expect(
      mapAwinRow({ aw_product_id: 'p3', aw_deep_link: 'x', product_name: 'n', search_price: 'abc' }, awinFeed),
    ).toBeNull();
  });

  it('retorna null quando fora de estoque ou não à venda', () => {
    const base = { aw_product_id: 'p1', aw_deep_link: 'https://x', product_name: 'n', search_price: '10' };
    expect(mapAwinRow({ ...base, in_stock: '0' }, awinFeed)).toBeNull();
    expect(mapAwinRow({ ...base, is_for_sale: '0' }, awinFeed)).toBeNull();
  });
});

describe('mapAwinRow — formato Google', () => {
  it('mapeia uma linha completa do CSV', () => {
    const row = {
      id: 'g1',
      title: 'Tênis Esportivo',
      link: 'https://loja.com/produto',
      aw_deep_link: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      image_link: 'https://x/img.png',
      availability: 'in_stock',
      price: '149.00 BRL',
      brand: 'Marca X',
      google_product_category: 'Calçados',
    };
    expect(mapAwinRow(row, googleFeed)).toEqual({
      feedId: 'f2',
      advertiserId: '222',
      advertiserName: 'Loja Y',
      externalId: 'g1',
      title: 'Tênis Esportivo',
      price: 149,
      originalPrice: null,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      raw: { format: 'Google', brand: 'Marca X', category: 'Calçados' },
    });
  });

  it('usa sale_price como preço e price como originalPrice quando sale_price < price', () => {
    const row = {
      id: 'g1',
      title: 'n',
      aw_deep_link: 'https://x',
      availability: 'in_stock',
      price: '100.00 BRL',
      sale_price: '80.00 BRL',
    };
    expect(mapAwinRow(row, googleFeed)).toMatchObject({ price: 80, originalPrice: 100 });
  });

  it('ignora sale_price quando não é menor que price', () => {
    const row = {
      id: 'g1',
      title: 'n',
      aw_deep_link: 'https://x',
      availability: 'in_stock',
      price: '100.00 BRL',
      sale_price: '120.00 BRL',
    };
    expect(mapAwinRow(row, googleFeed)).toMatchObject({ price: 100, originalPrice: null });
  });

  it('retorna null quando out_of_stock', () => {
    const row = {
      id: 'g1',
      title: 'n',
      aw_deep_link: 'https://x',
      availability: 'out_of_stock',
      price: '10.00 BRL',
    };
    expect(mapAwinRow(row, googleFeed)).toBeNull();
  });

  it('retorna null quando falta campo obrigatório', () => {
    expect(mapAwinRow({ id: 'g1' }, googleFeed)).toBeNull();
  });
});
