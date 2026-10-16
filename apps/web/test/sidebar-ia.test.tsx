import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/app-shell/sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/config/ia',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function mockMe(isSuperAdmin: boolean) {
  apiFetchMock.mockImplementation(async (path: string) =>
    path === '/me'
      ? {
          user: { name: 'Fulano', isSuperAdmin },
          tenant: { name: 'T' },
          isAffiliate: false,
          impersonating: null,
        }
      : {},
  );
}
function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Sidebar />
    </QueryClientProvider>,
  );
}
beforeEach(() => apiFetchMock.mockReset());

describe('Sidebar', () => {
  it('tem o link Configurações > IA apontando para /config/ia', async () => {
    mockMe(false);
    renderSidebar();
    expect(screen.getByRole('link', { name: /ia \(cta\)/i }).getAttribute('href')).toBe(
      '/config/ia',
    );
  });
  it('mostra "Afiliados" só para SuperAdmin', async () => {
    mockMe(true);
    renderSidebar();
    expect(await screen.findByRole('link', { name: /afiliados/i })).toBeTruthy();
  });
  it('não mostra "Afiliados" para usuário comum', async () => {
    mockMe(false);
    renderSidebar();
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/me'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: /afiliados/i })).toBeNull();
  });
});
