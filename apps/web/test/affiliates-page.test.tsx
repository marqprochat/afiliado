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
const confirmMock = vi.fn(() => true);
beforeEach(() => {
  confirmMock.mockReset();
  confirmMock.mockReturnValue(true);
  vi.stubGlobal('confirm', confirmMock);
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
    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/active', {
        method: 'POST',
        json: { active: false },
      }),
    );
  });
  it('desativar não chama a API se a confirmação for recusada', async () => {
    confirmMock.mockReturnValue(false);
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /desativar/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).not.toHaveBeenCalledWith('/admin/affiliates/a1/active', expect.anything());
  });
  it('ativar um afiliado desativado não pede confirmação e envia active:true', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/me')
        return {
          user: { isSuperAdmin: true },
          tenant: {},
          isAffiliate: false,
          impersonating: null,
        };
      if (path === '/admin/affiliates') return [{ ...row, active: false }];
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /^ativar joão/i }));
    expect(confirmMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/active', {
        method: 'POST',
        json: { active: true },
      }),
    );
  });
  it('redefine a senha com confirmação, mostra a nova senha e "Fechar" a remove', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/me')
        return {
          user: { isSuperAdmin: true },
          tenant: {},
          isAffiliate: false,
          impersonating: null,
        };
      if (path === '/admin/affiliates') return [row];
      if (path === '/admin/affiliates/a1/reset-password') return { password: 'NovaSenha42' };
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /redefinir senha/i }));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('NovaSenha42')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^fechar$/i }));
    expect(screen.queryByText('NovaSenha42')).toBeNull();
  });
  it('a nova senha some ao iniciar outra ação (editar)', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/me')
        return {
          user: { isSuperAdmin: true },
          tenant: {},
          isAffiliate: false,
          impersonating: null,
        };
      if (path === '/admin/affiliates') return [row];
      if (path === '/admin/affiliates/a1/reset-password') return { password: 'NovaSenha42' };
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /redefinir senha/i }));
    await screen.findByText('NovaSenha42');
    fireEvent.click(screen.getByRole('button', { name: /editar joão/i }));
    expect(screen.queryByText('NovaSenha42')).toBeNull();
  });
  it('redefinir senha recusado não chama a API', async () => {
    confirmMock.mockReturnValue(false);
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /redefinir senha/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      '/admin/affiliates/a1/reset-password',
      expect.anything(),
    );
  });
  it('editar envia PATCH sem password, apara SubIDs e envia vazio como ""', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me')
        return {
          user: { isSuperAdmin: true },
          tenant: {},
          isAffiliate: false,
          impersonating: null,
        };
      if (path === '/admin/affiliates/a1' && init?.method === 'PATCH') return row;
      if (path === '/admin/affiliates') return [row];
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /editar joão/i }));
    fireEvent.change(await screen.findByLabelText(/^nome$/i), {
      target: { value: '  João Silva ' },
    });
    fireEvent.change(screen.getByLabelText(/subid.*shopee/i), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/tracking id.*amazon/i), {
      target: { value: ' joao-20 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1', {
        method: 'PATCH',
        json: {
          name: 'João Silva',
          email: 'joao@x.com',
          subIds: { SHOPEE: '', AMAZON: 'joao-20' },
        },
      }),
    );
  });
  it('exibe a ajuda de cada SubID ligada por aria-describedby', async () => {
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /novo afiliado/i }));
    const input = await screen.findByLabelText(/subid.*shopee/i);
    const id = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)!.textContent).toMatch(/vendas do afiliado na Shopee/i);
  });
  it('criar com senha digitada inclui password no payload', async () => {
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /novo afiliado/i }));
    fireEvent.change(await screen.findByLabelText(/^nome$/i), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'nova@x.com' } });
    fireEvent.change(screen.getByLabelText(/senha inicial/i), { target: { value: 'MinhaSenha1' } });
    fireEvent.click(screen.getByRole('button', { name: /criar afiliado/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates', {
        method: 'POST',
        json: { name: 'Nova', email: 'nova@x.com', password: 'MinhaSenha1', subIds: {} },
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
    expect(screen.queryByRole('heading', { name: /afiliados/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /novo afiliado/i })).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/admin/affiliates');
  });
  it('enquanto /me carrega mostra só "Carregando…"', async () => {
    apiFetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /afiliados/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /novo afiliado/i })).toBeNull();
    expect(screen.queryByText(/restrita ao superadmin/i)).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalledWith('/admin/affiliates');
  });
});
