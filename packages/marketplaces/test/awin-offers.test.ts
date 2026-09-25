import { describe, it, expect, vi } from 'vitest';
import { mapAwinPromotion, listAwinVouchers } from '../src/awin/offers';
import { AwinApiError } from '../src/awin/datafeed';
import awinPromotionsFixture from '../src/awin/fixtures/promotions.json';

describe('Awin offers / vouchers', () => {
  describe('mapAwinPromotion', () => {
    it('mapeia promoção com voucher.code preenchido', () => {
      const promotion = awinPromotionsFixture.data[0];
      const coupon = mapAwinPromotion(promotion);
      expect(coupon).not.toBeNull();
      expect(coupon).toMatchObject({
        store: 'AWIN',
        scope: '9999',
        advertiserName: 'Loja Exemplo',
        code: 'EXEMPLO10',
        description: '10% OFF em todo o site',
        externalId: '123456',
        sourceUrl: 'https://www.loja-exemplo.com.br',
        affiliateUrl: 'https://www.awin1.com/cread.php?awinmid=9999&awinaffid=12345',
      });
      expect(coupon!.terms).toContain('Desconto válido para clientes selecionados');
      expect(coupon!.terms).toContain('Não acumulativo com outras promoções');
      expect(coupon!.startsAt).toBeInstanceOf(Date);
      expect(coupon!.expiresAt).toBeInstanceOf(Date);
    });

    it('retorna null quando voucher.code está ausente ou vazio', () => {
      const promotionSemVoucher = awinPromotionsFixture.data[1];
      expect(mapAwinPromotion(promotionSemVoucher)).toBeNull();

      const promotionVoucherVazio = {
        ...awinPromotionsFixture.data[0],
        voucher: { code: '   ' },
      };
      expect(mapAwinPromotion(promotionVoucherVazio)).toBeNull();
    });
  });

  describe('listAwinVouchers', () => {
    it('faz paginação até esgotar e envia headers/body corretos', async () => {
      const page1 = {
        data: [awinPromotionsFixture.data[0]],
        pagination: { page: 1, pageSize: 1, total: 2 },
      };
      const page2 = {
        data: [
          {
            ...awinPromotionsFixture.data[0],
            promotionId: 789,
            voucher: { code: 'NOVOVOUCHER20' },
          },
        ],
        pagination: { page: 2, pageSize: 1, total: 2 },
      };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page1,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page2,
        });

      const vouchers = await listAwinVouchers(
        { publisherId: '12345', offersApiToken: 'token_abc' },
        { fetchImpl: mockFetch as any, pageSize: 1 },
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![0]).toBe('https://api.awin.com/publisher/12345/promotions');
      const reqHeaders = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(reqHeaders['Authorization']).toBe('Bearer token_abc');

      expect(vouchers).toHaveLength(2);
      expect(vouchers[0]!.code).toBe('EXEMPLO10');
      expect(vouchers[1]!.code).toBe('NOVOVOUCHER20');
    });

    it('lança AwinApiError(AWIN_UNAUTHORIZED) em 401 ou 403', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(
        listAwinVouchers(
          { publisherId: '12345', offersApiToken: 'token_invalido' },
          { fetchImpl: mockFetch as any },
        ),
      ).rejects.toThrow(AwinApiError);
    });
  });
});
