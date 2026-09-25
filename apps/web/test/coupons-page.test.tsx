import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CuponsPage from '@/app/(app)/config/cupons/page';
import { CouponStatusBadge } from '@/components/coupons/coupon-status-badge';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const mockCoupons = [
  {
    id: 'c1',
    tenantId: 't1',
    store: 'SHOPEE',
    scope: '',
    advertiserName: null,
    code: 'PROMO10',
    description: '10% de desconto',
    terms: null,
    discountType: 'PERCENT',
    discountValue: 10,
    minSpend: 50,
    startsAt: null,
    expiresAt: null,
    status: 'VALID',
    origin: 'MANUAL',
    sourceUrl: null,
    affiliateUrl: null,
    externalId: null,
    remainingUses: null,
    lastSeenAt: null,
    lastVerifiedAt: '2026-09-25T12:00:00.000Z',
    fetchedAt: '2026-09-25T10:00:00.000Z',
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
  },
  {
    id: 'c2',
    tenantId: 't1',
    store: 'ALIEXPRESS',
    scope: '',
    advertiserName: null,
    code: 'ALI20',
    description: 'Cupom de 20 reais',
    terms: null,
    discountType: 'FIXED',
    discountValue: 20,
    minSpend: 100,
    startsAt: null,
    expiresAt: null,
    status: 'UNVERIFIED',
    origin: 'API',
    sourceUrl: null,
    affiliateUrl: null,
    externalId: null,
    remainingUses: null,
    lastSeenAt: null,
    lastVerifiedAt: null,
    fetchedAt: '2026-09-25T11:00:00.000Z',
    createdAt: '2026-09-25T11:00:00.000Z',
    updatedAt: '2026-09-25T11:00:00.000Z',
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CuponsPage />
    </QueryClientProvider>,
  );
}

describe('CuponsPage & Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/coupons')) {
        return { coupons: mockCoupons } as any;
      }
      return {} as any;
    });
  });

  it('renderiza o badge de status com o texto correto', () => {
    const { rerender } = render(<CouponStatusBadge status="VALID" />);
    expect(screen.getByText('Válido')).toBeDefined();

    rerender(<CouponStatusBadge status="UNVERIFIED" />);
    expect(screen.getByText('Não verificado')).toBeDefined();

    rerender(<CouponStatusBadge status="INVALID" />);
    expect(screen.getByText('Inválido')).toBeDefined();

    rerender(<CouponStatusBadge status="EXPIRED" />);
    expect(screen.getByText('Expirado')).toBeDefined();
  });

  it('carrega e lista os cupons na tabela', async () => {
    renderPage();

    expect(screen.getByText('Central de Cupons')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('PROMO10')).toBeDefined();
      expect(screen.getByText('ALI20')).toBeDefined();
    });

    expect(screen.getByText('10% OFF')).toBeDefined();
    expect(screen.getByText('R$ 20 OFF')).toBeDefined();
    expect(screen.getByText('Mín. R$ 50')).toBeDefined();
    expect(screen.getByText('Mín. R$ 100')).toBeDefined();
  });

  it('permite marcar cupom como inválido via botão de ação rápida', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('PROMO10')).toBeDefined();
    });

    // Clica no botão de marcar inválido (✕)
    const invalidButtons = screen.getAllByTitle('Marcar como Inválido');
    fireEvent.click(invalidButtons[0]!);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/coupons/c1/verify',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ result: 'INVALID' }),
        }),
      );
    });
  });

  it('abre modal de importação ao clicar em Importar de Texto', async () => {
    renderPage();

    const importBtn = screen.getByText('📋 Importar de Texto');
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(screen.getByText('Importar Cupons de Texto Livre')).toBeDefined();
    });
  });
});
