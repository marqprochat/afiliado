import { describe, it, expect } from 'vitest';
import { mapAwinCatalogRowToProductData } from '../src/awin';

describe('mapAwinCatalogRowToProductData', () => {
  it('mapeia uma linha do cache para ProductData com source AWIN', () => {
    const result = mapAwinCatalogRowToProductData({
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      imageUrl: 'https://x/img.png',
      deepLink: 'https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
      raw: { foo: 'bar' },
    });
    expect(result).toEqual({
      source: 'AWIN',
      externalId: 'p1',
      title: 'Fone Bluetooth',
      price: 99.9,
      originalPrice: 129.9,
      images: ['https://x/img.png'],
      shipping: 'UNKNOWN',
      originalUrl: 'https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
      raw: { foo: 'bar' },
    });
  });

  it('omite originalPrice e images quando ausentes', () => {
    const result = mapAwinCatalogRowToProductData({
      externalId: 'p2',
      title: 'Caneca',
      price: 20,
      originalPrice: null,
      imageUrl: null,
      deepLink: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      raw: {},
    });
    expect(result.originalPrice).toBeUndefined();
    expect(result.images).toEqual([]);
  });
});
