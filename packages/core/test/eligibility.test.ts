import { describe, it, expect } from 'vitest';
import { isEligibleProduct, isEligibleCoupon } from '../src/eligibility';

const baseProduct = {
  title: 'Fone Bluetooth',
  price: 99.9,
  images: ['https://x/img.png'],
  originalUrl: 'https://shopee.com.br/p/1',
  raw: {} as Record<string, unknown>,
};

describe('isEligibleProduct', () => {
  it('aceita produto completo', () => {
    expect(isEligibleProduct(baseProduct)).toEqual({ ok: true });
  });

  it('rejeita produto ainda em enriquecimento', () => {
    const r = isEligibleProduct({ ...baseProduct, raw: { pendingEnrich: true } });
    expect(r).toEqual({ ok: false, reason: 'pending-enrich' });
  });

  it('rejeita título vazio ou placeholder', () => {
    expect(isEligibleProduct({ ...baseProduct, title: '' })).toEqual({
      ok: false,
      reason: 'empty-title',
    });
    expect(isEligibleProduct({ ...baseProduct, title: 'Importando…' })).toEqual({
      ok: false,
      reason: 'empty-title',
    });
  });

  it('rejeita preço zero ou negativo', () => {
    expect(isEligibleProduct({ ...baseProduct, price: 0 })).toEqual({
      ok: false,
      reason: 'invalid-price',
    });
  });

  it('rejeita sem imagens', () => {
    expect(isEligibleProduct({ ...baseProduct, images: [] })).toEqual({
      ok: false,
      reason: 'no-images',
    });
  });

  it('rejeita URL inválida', () => {
    expect(isEligibleProduct({ ...baseProduct, originalUrl: 'não é url' })).toEqual({
      ok: false,
      reason: 'invalid-url',
    });
  });
});

describe('isEligibleCoupon', () => {
  it('aceita cupom sem validade', () => {
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null })).toEqual({ ok: true });
  });

  it('aceita cupom com validade futura', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: future })).toEqual({ ok: true });
  });

  it('rejeita cupom expirado', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: past })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejeita cupom com status INVALID ou EXPIRED', () => {
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null, status: 'INVALID' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null, status: 'EXPIRED' })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null, status: 'VALID' })).toEqual({
      ok: true,
    });
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null, status: 'UNVERIFIED' })).toEqual({
      ok: true,
    });
  });

  it('rejeita código vazio', () => {
    expect(isEligibleCoupon({ code: '', expiresAt: null })).toEqual({
      ok: false,
      reason: 'empty-code',
    });
  });
});

