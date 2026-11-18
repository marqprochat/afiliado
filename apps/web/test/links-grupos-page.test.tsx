import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LinksGruposPage from '@/app/(app)/links-grupos/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LinksGruposPage />
    </QueryClientProvider>,
  );
}

describe('LinksGruposPage Landing URL', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('direciona o dono da aplicação (!isAffiliate / SuperAdmin) para /landpage', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'u1', email: 'admin@dudurocha.com', name: 'Admin', role: 'OWNER', isSuperAdmin: true },
          tenant: { id: 't1', name: 'default' },
          isAffiliate: false,
          impersonating: null,
        };
      }
      if (path === '/group-links') return [];
      return undefined;
    });

    renderPage();

    await waitFor(() => {
      const btn = screen.getByRole('link', { name: /Ver Landing Page/i });
      expect(btn).toHaveAttribute('href', '/landpage');
    });
  });

  it('direciona o afiliado (isAffiliate: true) para /lp/${slug}', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'u2', email: 'afiliado@teste.com', name: 'Afiliado VIP', role: 'USER', isSuperAdmin: false },
          tenant: { id: 't2', name: 'afiliado-vip' },
          isAffiliate: true,
          impersonating: null,
        };
      }
      if (path === '/affiliate-landing') {
        return {
          ok: true,
          data: { slug: 'meu-clube-vip' },
        };
      }
      if (path === '/group-links') return [];
      return undefined;
    });

    renderPage();

    await waitFor(() => {
      const btn = screen.getByRole('link', { name: /Ver Landing Page/i });
      expect(btn).toHaveAttribute('href', '/lp/meu-clube-vip');
    });
  });
});
