import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketplacesClient } from '@/app/(app)/marketplaces/marketplaces-client';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const kinds = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU', 'AWIN', 'ALIEXPRESS'];

function mockMe(isAffiliate: boolean) {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/me')
      return { user: { isSuperAdmin: false }, tenant: {}, isAffiliate, impersonating: null };
    if (path === '/marketplaces')
      return kinds.map((kind) => ({
        kind,
        status: 'UNCONFIGURED',
        subId: null,
        hasSecret: false,
        awinFeedIds: [],
      }));
    return undefined;
  });
}
function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarketplacesClient />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  apiFetchMock.mockReset();
  search = '';
});

describe('MarketplacesClient por papel', () => {
  it('afiliado vê os 6 campos de identificador, sem cartões de credencial', async () => {
    search = 'open=AMAZON';
    mockMe(true);
    renderIt();
    expect(await screen.findAllByRole('textbox')).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /configurar/i })).toBeNull();
  });
  it('raiz vê os cartões de credencial', async () => {
    mockMe(false);
    renderIt();
    expect((await screen.findAllByRole('button', { name: /configurar/i })).length).toBeGreaterThan(
      0,
    );
  });
  it('enquanto /me carrega não renderiza nenhum dos dois nem abre o drawer de ?open=', async () => {
    search = 'open=AMAZON';
    apiFetchMock.mockImplementation(() => new Promise(() => {}));
    renderIt();
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configurar/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/marketplaces');
  });
});
