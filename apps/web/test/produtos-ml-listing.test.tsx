import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProdutosPage from '@/app/(app)/produtos/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ useRealtime: () => {} }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/marketplaces') return [{ kind: 'MERCADOLIVRE', hasMlApi: false }];
    if (path === '/queue') return { items: [], limit: 100, count: 0 };
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProdutosPage />
    </QueryClientProvider>,
  );
}

describe('Buscar Produtos: Ofertas do ML', () => {
  it('a subaba só existe para o Mercado Livre', () => {
    renderPage();
    expect(screen.queryByText('Ofertas do ML')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByRole('button', { name: 'Ofertas do ML' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(screen.queryByText('Ofertas do ML')).toBeNull();
  });

  it('ao escolher o ML sem a API oficial, abre direto em Ofertas do ML', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByLabelText('Fonte da listagem')).toBeTruthy();
  });

  it('busca chama /products/search com mlListing', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/marketplaces') return [{ kind: 'MERCADOLIVRE', hasMlApi: false }];
      if (path === '/queue') return { items: [], limit: 100, count: 0 };
      if (path === '/products/search') return { products: [] };
      throw new Error(`unexpected call: ${path}`);
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }));
    await vi.waitFor(() => {
      const call = apiFetchMock.mock.calls.find(([p]) => p === '/products/search');
      expect(call).toBeTruthy();
      expect((call?.[1] as { json: unknown }).json).toMatchObject({
        source: 'MERCADOLIVRE',
        mode: 'listing',
        mlListing: { kind: 'deals' },
      });
    });
  });
});
