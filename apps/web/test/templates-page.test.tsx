import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TemplatesPage from '@/app/(app)/config/templates/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const templates = [
  { id: 'tp', name: 'Produto', body: '{titulo}', isDefault: true, kind: 'PRODUCT' },
  { id: 'tc', name: 'Cupom X', body: '{codigo}', isDefault: false, kind: 'COUPON' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/templates') return templates as never;
    if (url === '/templates/coupon-example') {
      return { id: 'tx', name: 'Cupom (exemplo)', body: '{codigo}', isDefault: false, kind: 'COUPON' } as never;
    }
    if (url === '/templates/preview') return { text: 'prévia' } as never;
    if (url.startsWith('/coupons')) return { coupons: [] } as never;
    return {} as never;
  });
});

describe('página de templates', () => {
  it('identifica os templates de cupom na lista', async () => {
    renderPage();
    expect(await screen.findByText('Cupom X')).toBeDefined();
    expect(screen.getByText('Cupom')).toBeDefined();
  });

  it('botão cria o template de cupom de exemplo', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar template de exemplo de cupom' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/templates/coupon-example',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('"Novo template de cupom" cria com kind COUPON', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo template de cupom' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/templates',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({ kind: 'COUPON' }),
        }),
      ),
    );
  });
});
