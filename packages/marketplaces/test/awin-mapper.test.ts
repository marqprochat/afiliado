import { describe, it, expect } from 'vitest';
import { mapAwinRow } from '../src/awin/mapper';

const feed = { feedId: 'f1', advertiserId: '111', advertiserName: 'Loja X' };

describe('mapAwinRow', () => {
  it('mapeia uma linha completa do CSV', () => {
    const row = {
      aw_product_id: 'p1',
      aw_deep_link: 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=x',
      product_name: 'Fone Bluetooth',
      search_price: '99.90',
      rrp_price: '129.90',
      merchant_image_url: 'https://x/img.png',
    };
    expect(mapAwinRow(row, feed)).toEqual({
      feedId: 'f1',
      advertiserId: '111',
      advertiserName: 'Loja X',
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=x',
      raw: row,
    });
  });

  it('ignora rrp_price quando não é maior que o preço atual', () => {
    const row = {
      aw_product_id: 'p2',
      aw_deep_link: 'https://www.awin1.com/cread.php?x',
      product_name: 'Caneca',
      search_price: '20.00',
      rrp_price: '15.00',
    };
    expect(mapAwinRow(row, feed)?.originalPrice).toBeNull();
  });

  it('retorna null quando falta um campo obrigatório', () => {
    expect(mapAwinRow({ aw_product_id: 'p3' }, feed)).toBeNull();
    expect(mapAwinRow({ aw_product_id: 'p3', aw_deep_link: 'x', product_name: 'n', search_price: 'abc' }, feed)).toBeNull();
  });
});
