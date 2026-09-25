import { describe, it, expect } from 'vitest';
import {
  couponInputSchema,
  couponListQuerySchema,
  couponVerifySchema,
  couponParseSchema,
  couponBulkSchema,
  COUPON_ORIGINS,
  COUPON_STATUSES,
  COUPON_DISCOUNT_TYPES,
} from '../src/coupon';

describe('coupon schemas', () => {
  it('normaliza code com trim e toUpperCase', () => {
    const res = couponInputSchema.parse({
      store: 'SHOPEE',
      code: '  bemvindo10 ',
      description: '10% de desconto',
    });
    expect(res.code).toBe('BEMVINDO10');
  });

  it('rejeita code curto (< 3 caracteres)', () => {
    expect(() =>
      couponInputSchema.parse({
        store: 'SHOPEE',
        code: 'AB',
        description: '10% de desconto',
      }),
    ).toThrow();
  });

  it('rejeita code longo (> 40 caracteres)', () => {
    expect(() =>
      couponInputSchema.parse({
        store: 'SHOPEE',
        code: 'A'.repeat(41),
        description: '10% de desconto',
      }),
    ).toThrow();
  });

  it('couponVerifySchema aceita VALID e INVALID, mas rejeita EXPIRED', () => {
    expect(couponVerifySchema.parse({ result: 'VALID' })).toEqual({ result: 'VALID' });
    expect(couponVerifySchema.parse({ result: 'INVALID', note: 'Esgotado' })).toEqual({
      result: 'INVALID',
      note: 'Esgotado',
    });
    expect(() => couponVerifySchema.parse({ result: 'EXPIRED' })).toThrow();
    expect(() => couponVerifySchema.parse({ result: 'UNVERIFIED' })).toThrow();
  });

  it('couponListQuerySchema converte includeExpired=true em boolean', () => {
    const res = couponListQuerySchema.parse({
      includeExpired: 'true',
      store: 'ALIEXPRESS',
      status: 'VALID',
    });
    expect(res.includeExpired).toBe(true);
    expect(res.store).toBe('ALIEXPRESS');
    expect(res.status).toBe('VALID');
  });

  it('couponParseSchema valida texto e store opcional', () => {
    const res = couponParseSchema.parse({
      text: 'CUPOM PROMO10 10% OFF',
      store: 'AMAZON',
    });
    expect(res.text).toBe('CUPOM PROMO10 10% OFF');
    expect(res.store).toBe('AMAZON');
  });

  it('couponBulkSchema valida lista de cupons e normaliza cada um', () => {
    const res = couponBulkSchema.parse({
      coupons: [
        { store: 'MAGALU', code: '  magalu10 ', description: '10% off' },
        { store: 'MERCADOLIVRE', code: 'meli20', description: 'R$ 20 off' },
      ],
    });
    expect(res.coupons.length).toBe(2);
    expect(res.coupons[0]!.code).toBe('MAGALU10');
    expect(res.coupons[1]!.code).toBe('MELI20');
  });

  it('exporta constantes de domínio', () => {
    expect(COUPON_ORIGINS).toContain('MANUAL');
    expect(COUPON_STATUSES).toContain('UNVERIFIED');
    expect(COUPON_DISCOUNT_TYPES).toContain('PERCENT');
  });
});
