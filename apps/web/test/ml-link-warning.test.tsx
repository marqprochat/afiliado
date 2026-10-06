import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplacesClient } from '@/app/(app)/marketplaces/marketplaces-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const base = { status: 'OK', affiliateTag: null, lastError: null, lastCheckedAt: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketplacesClient />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetchMock.mockReset());

describe('aviso do gerador de links em lote', () => {
  it('mostra o erro e quantos links foram salvos pelo método individual', async () => {
    apiFetchMock.mockResolvedValue([
      { ...base, kind: 'SHOPEE' },
      {
        ...base,
        kind: 'MERCADOLIVRE',
        mlLinkBatchError: {
          at: '2026-10-05T17:30:00.000Z',
          message: 'Gerador de links do ML respondeu HTTP 500',
          urls: 5,
          recoveredByFallback: 3,
        },
      },
    ]);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Gerador de links em lote falhou/);
    expect(alert.textContent).toMatch(/Gerador de links do ML respondeu HTTP 500/);
    expect(alert.textContent).toMatch(/3 de 5/);
  });

  it('não mostra aviso quando não há erro', async () => {
    apiFetchMock.mockResolvedValue([{ ...base, kind: 'MERCADOLIVRE', mlLinkBatchError: null }]);
    renderPage();
    await screen.findByText('Mercado Livre');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
