import { describe, it, expect, vi } from 'vitest';
import { mapPromoCodeInfo, fetchAliexpressPromoCodes } from '../src/aliexpress/coupons';
import promoProducts from '../src/aliexpress/fixtures/promo-code-products.json';
import { AliexpressClient } from '../src/aliexpress/client';

describe('AliExpress coupons', () => {
  describe('mapPromoCodeInfo', () => {
    it('mapeia produto com code_campaigntype=1 (FIXED)', () => {
      const product = promoProducts[0];
      const coupon = mapPromoCodeInfo(product);
      expect(coupon).not.toBeNull();
      expect(coupon).toMatchObject({
        store: 'ALIEXPRESS',
        scope: '',
        code: 'LV6WVV6WZV3M',
        discountType: 'FIXED',
        discountValue: 5.02,
        minSpend: 83.6,
        remainingUses: 1946,
        externalId: '1005007454316161',
        sourceUrl: 'https://pt.aliexpress.com/item/1005007454316161.html',
        affiliateUrl: 'https://s.click.aliexpress.com/e/_promo1',
      });
      expect(coupon!.startsAt).toBeInstanceOf(Date);
      expect(coupon!.expiresAt).toBeInstanceOf(Date);
    });

    it('mapeia produto com code_campaigntype=2 (PERCENT)', () => {
      const product = promoProducts[1];
      const coupon = mapPromoCodeInfo(product);
      expect(coupon).not.toBeNull();
      expect(coupon).toMatchObject({
        store: 'ALIEXPRESS',
        scope: '',
        code: 'FONES15OFF',
        discountType: 'PERCENT',
        discountValue: 15,
        minSpend: 50,
        remainingUses: 500,
      });
    });

    it('retorna null para produto sem promo_code_info ou com promo_code vazio', () => {
      const productSemCupom = promoProducts[2];
      expect(mapPromoCodeInfo(productSemCupom)).toBeNull();

      const productVazio = {
        ...promoProducts[0],
        promo_code_info: { promo_code: '   ' },
      };
      expect(mapPromoCodeInfo(productVazio)).toBeNull();
    });
  });

  describe('fetchAliexpressPromoCodes', () => {
    it('executa queries com keywords e deduplica por code mantendo maior validade', async () => {
      const client = new AliexpressClient({
        appKey: 'test-key',
        appSecret: 'test-secret',
        trackingId: 'test-track',
      });

      const executeSpy = vi.spyOn(client, 'execute').mockResolvedValue({
        resp_result: {
          resp_code: 200,
          result: {
            products: {
              product: [
                promoProducts[0],
                promoProducts[1],
                // Duplicata do primeiro cupom com validade menor
                {
                  ...promoProducts[0],
                  product_id: 1234567,
                  promo_code_info: {
                    ...promoProducts[0]!.promo_code_info,
                    code_availabletime_end: '2026-12-31 23:59:59',
                  },
                },
              ],
            },
          },
        },
      });

      const coupons = await fetchAliexpressPromoCodes(
        { appKey: 'test-key', appSecret: 'test-secret', trackingId: 'test-track' },
        { keywords: ['fone'], maxPages: 1, client },
      );

      expect(executeSpy).toHaveBeenCalled();
      expect(coupons).toHaveLength(2);
      const c1 = coupons.find((c) => c.code === 'LV6WVV6WZV3M');
      expect(c1).toBeDefined();
      // Manteve a de 2027 (maior validade)
      expect(c1!.expiresAt?.getFullYear()).toBe(2027);
    });
  });
});
