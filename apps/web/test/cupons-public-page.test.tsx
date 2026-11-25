import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/landing/landing-nav', () => ({ LandingNav: () => null }));
vi.mock('@/components/landing/landing-footer', () => ({ LandingFooter: () => null }));

import PublicCuponsPage from '@/app/cupons/page';

describe('/cupons público', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista cupons ativos e busca cupons ao colar link de produto', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/public/coupons') {
        return {
          ok: true,
          json: async () => ({
            coupons: [
              {
                id: 'c1',
                store: 'SHOPEE',
                advertiserName: null,
                code: 'SHOPEE10',
                description: 'R$ 10 OFF em compras acima de R$ 50',
                terms: null,
                discountType: null,
                discountValue: null,
                minSpend: 50,
                expiresAt: '2026-12-31T23:59:59.000Z',
                affiliateUrl: 'https://shope.ee/aff1',
                sourceUrl: null,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          marketplace: 'SHOPEE',
          storeLabel: 'Shopee',
          originalUrl: 'https://shopee.com.br/produto-x',
          resolvedUrl: 'https://shopee.com.br/produto-x',
          affiliateUrl: 'https://shope.ee/rastreado',
          coupons: [
            {
              id: 'c2',
              store: 'SHOPEE',
              advertiserName: 'Shopee Oficial',
              code: 'VIP20',
              description: '20% OFF no app',
              terms: null,
              discountType: null,
              discountValue: null,
              minSpend: null,
              expiresAt: null,
              affiliateUrl: null,
              sourceUrl: null,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicCuponsPage />);
    expect(await screen.findByText('SHOPEE10')).toBeInTheDocument();

    const input = screen.getByLabelText(/link do produto ou loja/i);
    fireEvent.change(input, { target: { value: 'https://shopee.com.br/produto-x' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar cupons/i }));

    await waitFor(() => {
      expect(screen.getByText('VIP20')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /ir para shopee/i })).toHaveAttribute(
        'href',
        'https://shope.ee/rastreado',
      );
    });
  });
});
