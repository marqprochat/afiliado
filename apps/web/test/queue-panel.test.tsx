import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueuePanel } from '@/components/automations/queue-panel';
import type { AutomationQueueItem } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const items: AutomationQueueItem[] = [
  {
    id: 'q1',
    kind: 'PRODUCT',
    manual: false,
    status: 'PENDING',
    addedAt: '2026-09-22T00:00:00.000Z',
    marketplace: 'SHOPEE',
    product: {
      id: 'p1',
      source: 'SHOPEE',
      externalId: '1',
      title: 'Fone Bluetooth',
      price: 50,
      originalPrice: null,
      discountPct: null,
      salesCount: null,
      commissionPct: null,
      images: [],
      shipping: 'UNKNOWN',
      flashSaleEndsAt: null,
      couponCode: null,
      originalUrl: 'https://shopee.com.br/p/1',
      shopId: null,
      shopName: null,
    },
    coupon: null,
  },
  {
    id: 'q2',
    kind: 'COUPON',
    manual: true,
    status: 'PENDING',
    addedAt: '2026-09-22T00:01:00.000Z',
    marketplace: 'AMAZON',
    product: null,
    coupon: { id: 'c1', store: 'AMAZON', code: 'PROMO10', description: '10% off', expiresAt: null, sourceUrl: null },
  },
];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueuePanel ruleId="rule-1" />
    </QueryClientProvider>,
  );
}

describe('QueuePanel', () => {
  it('mostra o badge do marketplace de cada item, incluindo cupons', async () => {
    apiFetchMock.mockResolvedValue(items);
    renderPanel();
    expect(await screen.findByText('Fone Bluetooth')).toBeInTheDocument();
    expect(screen.getByText('Shopee')).toBeInTheDocument();
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByText('Cupom PROMO10')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
  });

  it('clicar na linha do item abre o link original em nova aba', async () => {
    apiFetchMock.mockResolvedValue(items);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();
    const title = await screen.findByText('Fone Bluetooth');
    fireEvent.click(title.closest('li')!);
    expect(openSpy).toHaveBeenCalledWith(
      'https://shopee.com.br/p/1',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });
});
