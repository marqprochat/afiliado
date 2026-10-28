import { describe, expect, it } from 'vitest';
import {
  normalizeProductTitle,
  findBestProductMatch,
  analyzeDealPromotion,
} from '../src/deduplication';

describe('deduplication & price engine', () => {
  it('normalizes marketplace titles removing promotional noise', () => {
    const raw = '🔥 Apple iPhone 15 128GB Preto FRETE GRÁTIS ENVIO HOJE NOVO NF-E Lacrado!';
    const norm = normalizeProductTitle(raw);

    expect(norm.brand).toBe('Apple');
    expect(norm.cleanTitle).not.toContain('FRETE GRÁTIS');
    expect(norm.cleanTitle).not.toContain('ENVIO HOJE');
    expect(norm.cleanTitle).not.toContain('🔥');
    expect(norm.tokens).toContain('iphone');
    expect(norm.tokens).toContain('128gb');
    expect(norm.slug).toContain('apple-iphone-15-128gb-preto');
  });

  it('matches products by identical EAN', () => {
    const candidate = {
      id: 'prod-1',
      title: 'Smartphone Apple iPhone 15 128GB',
      ean: '195949038234',
      brand: 'Apple',
      currentBestPrice: 4500,
    };

    const newProd = {
      title: 'iPhone 15 128 GB Preto Original Apple',
      ean: '195949038234',
      brand: 'Apple',
      price: 4399,
    };

    const match = findBestProductMatch(newProd, [candidate]);
    expect(match?.id).toBe('prod-1');
  });

  it('matches products by fuzzy token similarity when EAN is missing', () => {
    const candidate = {
      id: 'prod-airfryer',
      title: 'Fritadeira Sem Óleo Air Fryer Philips Walita Série 3000 4.1L Preta',
      ean: null,
      brand: 'Philips',
      currentBestPrice: 380,
    };

    const incoming = {
      title: 'Airfryer Philips Walita 4.1 Litros Serie 3000 Preto 110V',
      ean: null,
      brand: 'Philips',
      price: 369,
    };

    const match = findBestProductMatch(incoming, [candidate], 0.4);
    expect(match?.id).toBe('prod-airfryer');
  });

  it('does NOT match if brands are distinct', () => {
    const candidate = {
      id: 'prod-samsung',
      title: 'Smart TV 50 Polegadas 4K Samsung Crystal UHD',
      ean: null,
      brand: 'Samsung',
      currentBestPrice: 2200,
    };

    const incoming = {
      title: 'Smart TV 50 Polegadas 4K LG UHD ThinQ AI',
      ean: null,
      brand: 'LG',
      price: 2150,
    };

    const match = findBestProductMatch(incoming, [candidate]);
    expect(match).toBeNull();
  });

  it('analyzes deal and detects ALL_TIME_LOW', () => {
    const history = [
      { price: 5000 },
      { price: 4800 },
      { price: 4600 },
    ];

    const currentPrice = 4199;
    const deal = analyzeDealPromotion(history, currentPrice, 5200);

    expect(deal.badge).toBe('ALL_TIME_LOW');
    expect(deal.isRealPromotion).toBe(true);
    expect(deal.lowestPriceEver).toBe(4199);
  });

  it('detects fake promotions / inflated discounts', () => {
    const history = [
      { price: 300 },
      { price: 310 },
      { price: 295 },
    ];

    const deal = analyzeDealPromotion(history, 305, 600);
    expect(deal.badge).toBe('INFLATED_DISCOUNT');
    expect(deal.isRealPromotion).toBe(false);
  });
});
