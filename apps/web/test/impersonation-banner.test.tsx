import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationBanner } from '@/components/app-shell/impersonation-banner';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationBanner />
    </QueryClientProvider>,
  );
}
beforeEach(() => apiFetchMock.mockReset());

describe('ImpersonationBanner', () => {
  it('não aparece fora da impersonação', async () => {
    apiFetchMock.mockResolvedValue({
      user: { name: 'Fulano', isSuperAdmin: false },
      tenant: { name: 'T' },
      isAffiliate: true,
      impersonating: null,
    });
    renderBanner();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/acessando como/i)).toBeNull();
  });
  it('mostra o nome e volta ao admin', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    apiFetchMock.mockImplementation(async (path: string) =>
      path === '/me'
        ? {
            user: { name: 'Fulano' },
            tenant: { name: 'Loja do Fulano' },
            isAffiliate: true,
            impersonating: { by: 'Admin' },
          }
        : undefined,
    );
    renderBanner();
    expect(await screen.findByText(/acessando como/i)).toHaveTextContent('Loja do Fulano');
    fireEvent.click(screen.getByRole('button', { name: /voltar ao admin/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/impersonation/stop', { method: 'POST' }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/afiliados'));
  });
});
