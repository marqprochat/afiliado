import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AffiliatesClient } from '@/components/affiliates/affiliates-client';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const row = {
  id: 'a1',
  userId: 'u1',
  name: 'João',
  email: 'joao@x.com',
  active: true,
  createdAt: '2026-10-16T10:00:00.000Z',
  waConnected: true,
  groups: 3,
  sends7d: 12,
  subIds: { SHOPEE: 'joao' },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AffiliatesClient />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/me')
      return { user: { isSuperAdmin: true }, tenant: {}, isAffiliate: false, impersonating: null };
    if (path === '/admin/affiliates') return [row];
    return undefined;
  });
});

describe('AffiliatesClient', () => {
  it('lista afiliados com métricas', async () => {
    renderPage();
    expect(await screen.findByText('João')).toBeInTheDocument();
    expect(screen.getByText('joao@x.com')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
  it('desativa um afiliado', async () => {
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /desativar/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/active', {
        method: 'POST',
        json: { active: false },
      }),
    );
  });
  it('entra como o afiliado', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /entrar como/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/impersonate', {
        method: 'POST',
      }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
  it('cria afiliado e mostra a senha gerada uma vez', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me')
        return {
          user: { isSuperAdmin: true },
          tenant: {},
          isAffiliate: false,
          impersonating: null,
        };
      if (path === '/admin/affiliates' && init?.method === 'POST')
        return { ...row, id: 'a2', initialPassword: 'Senha123gerada' };
      if (path === '/admin/affiliates') return [row];
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /novo afiliado/i }));
    fireEvent.change(await screen.findByLabelText(/nome/i), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'nova@x.com' } });
    fireEvent.change(screen.getByLabelText(/subid.*shopee|shopee/i), { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: /criar afiliado/i }));
    expect(await screen.findByText('Senha123gerada')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates', {
      method: 'POST',
      json: { name: 'Nova', email: 'nova@x.com', subIds: { SHOPEE: 'nova' } },
    });
  });
  it('não-SuperAdmin vê aviso', async () => {
    apiFetchMock.mockImplementation(async (path: string) =>
      path === '/me'
        ? { user: { isSuperAdmin: false }, tenant: {}, isAffiliate: false, impersonating: null }
        : [],
    );
    renderPage();
    expect(await screen.findByText(/restrita ao superadmin/i)).toBeInTheDocument();
  });
});
