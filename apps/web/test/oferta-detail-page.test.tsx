import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'tv-55-ab12' }) }));
vi.mock('@/components/landing/landing-nav', () => ({ LandingNav: () => null }));
vi.mock('@/components/landing/landing-footer', () => ({ LandingFooter: () => null }));
vi.mock('@/components/deals/price-history-chart', () => ({ PriceHistoryChart: () => null }));
vi.mock('@/components/deals/price-alert-modal', () => ({ PriceAlertModal: () => null }));

import OfertaDetailPage from '@/app/ofertas/[slug]/page';

const deal = (listings: unknown[]) => ({
  id: 'm1',
  title: 'Smart TV 55 Samsung',
  cleanTitle: 'Smart TV 55 Samsung',
  slug: 'tv-55-ab12',
  brand: 'Samsung',
  category: 'TV & Vídeo',
  imageUrl: 'https://img.test/tv.jpg',
  images: ['https://img.test/tv.jpg'],
  currentBestPrice: 2999,
  lowestPriceEver: 2999,
  averagePrice30d: 2999,
  listingsCount: listings.length,
  analysis: {
    badge: 'FAIR_PRICE',
    badgeLabel: 'Preço Regular',
    averagePrice: 2999,
    lowestPriceEver: 2999,
    realDiscountPct: 0,
    isRealPromotion: false,
  },
  listings,
  priceHistory: [],
  coupons: [],
});

function mockFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe('/ofertas/[slug]', () => {
  it('produto sem lojas: "Oferta indisponível no momento", sem preço, com título, foto e volta', async () => {
    mockFetch(deal([]));
    render(<OfertaDetailPage />);
    expect(await screen.findByText('Oferta indisponível no momento')).toBeTruthy();
    expect(screen.getAllByText('Smart TV 55 Samsung').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Smart TV 55 Samsung' })).toBeTruthy();
    expect(screen.queryByText(/2\.999,00/)).toBeNull();
    expect(screen.queryByText(/Ir para/)).toBeNull();
    const back = screen.getByRole('link', { name: /ofertas/i });
    expect(back.getAttribute('href')).toBe('/ofertas');
  });

  it('produto com loja: mostra o preço e o botão da loja', async () => {
    mockFetch(
      deal([
        {
          id: 'l1',
          storeName: 'Shopee',
          source: 'SHOPEE',
          currentPrice: 2999,
          affiliateUrl: 'https://aff.test/1',
        },
      ]),
    );
    render(<OfertaDetailPage />);
    expect(await screen.findByText(/Ir para Shopee/)).toBeTruthy();
    expect(screen.queryByText('Oferta indisponível no momento')).toBeNull();
    expect(screen.getAllByText(/2\.999,00/).length).toBeGreaterThan(0);
  });
});
