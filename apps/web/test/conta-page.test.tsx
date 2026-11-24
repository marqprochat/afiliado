import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContaPage from '@/app/(app)/config/conta/page';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiClientError: class extends Error {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const settings = {
  window: { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true },
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};

function mockApi(
  isAffiliate: boolean,
  { isSuperAdmin = !isAffiliate, impersonating = null as { by: string } | null } = {},
) {
  apiFetchMock.mockImplementation(async (url: string, opts?: unknown) => {
    if (url === '/me')
      return {
        user: { id: 'u', email: 'dono@teste.local', name: 'Dono', role: 'OWNER', isSuperAdmin },
        tenant: { id: 't', name: 'T' },
        isAffiliate,
        impersonating,
      } as never;
    if (url === '/settings') return settings as never;
    if (url === '/settings/site-links') return (opts ? { enabled: true } : { enabled: false }) as never;
    return {} as never;
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContaPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Minha Conta > link do site', () => {
  it('dono liga a chave e a página envia PUT /settings/site-links', async () => {
    mockApi(false);
    renderPage();
    const toggle = await screen.findByRole('switch', { name: /link do site/i });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/settings/site-links', {
        method: 'PUT',
        json: { enabled: true },
      }),
    );
  });

  it('afiliado não vê a chave nem consulta a configuração', async () => {
    mockApi(true);
    renderPage();
    await screen.findByText(/dono@teste.local/);
    expect(screen.queryByRole('switch', { name: /link do site/i })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/settings/site-links');
  });

  it('dono de outra conta (não superadmin) não vê a chave nem consulta a configuração', async () => {
    mockApi(false, { isSuperAdmin: false });
    renderPage();
    await screen.findByText(/dono@teste.local/);
    expect(screen.queryByRole('switch', { name: /link do site/i })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/settings/site-links');
  });

  it('superadmin personificando outra conta não vê a chave', async () => {
    mockApi(false, { isSuperAdmin: true, impersonating: { by: 'admin' } });
    renderPage();
    await screen.findByText(/dono@teste.local/);
    expect(screen.queryByRole('switch', { name: /link do site/i })).toBeNull();
  });
});
