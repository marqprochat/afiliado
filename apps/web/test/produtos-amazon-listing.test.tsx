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
    if (path === '/products/search') return { products: [] };
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

const lastSearchBody = () => {
  const call = apiFetchMock.mock.calls.find(([p]) => p === '/products/search');
  return (call?.[1] as { json: unknown } | undefined)?.json;
};

describe('Buscar Produtos: Ofertas da Amazon', () => {
  it('a subaba só existe para a Amazon', () => {
    renderPage();
    expect(screen.queryByText('Ofertas da Amazon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(screen.getByRole('button', { name: 'Ofertas da Amazon' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.queryByText('Ofertas da Amazon')).toBeNull();
  });

  it('ao escolher a Amazon abre direto em Ofertas da Amazon', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(screen.getByLabelText('Fonte das ofertas da Amazon')).toBeTruthy();
    expect(screen.queryByLabelText('Fonte da listagem')).toBeNull();
  });

  it('ML → Amazon → ML troca de formulário sem ficar preso em outra subaba', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByLabelText('Fonte da listagem')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(screen.getByLabelText('Fonte das ofertas da Amazon')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado Livre' }));
    expect(screen.getByLabelText('Fonte da listagem')).toBeTruthy();
  });

  it('ofertas por palavra-chave: Buscar fica desabilitado sem termo e envia amazonListing + query', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    const buscar = screen.getByRole('button', { name: /^buscar$/i }) as HTMLButtonElement;
    expect(buscar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Palavra-chave das ofertas'), {
      target: { value: '  celular ' },
    });
    expect(buscar.disabled).toBe(false);
    fireEvent.click(buscar);
    await vi.waitFor(() => {
      expect(lastSearchBody()).toMatchObject({
        source: 'AMAZON',
        mode: 'listing',
        amazonListing: { kind: 'deals' },
        query: 'celular',
      });
    });
  });

  it('Mega Oferta Prime: busca sem termo e não manda query', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Amazon' }));
    fireEvent.change(screen.getByLabelText('Fonte das ofertas da Amazon'), {
      target: { value: 'mega' },
    });
    const buscar = screen.getByRole('button', { name: /^buscar$/i }) as HTMLButtonElement;
    expect(buscar.disabled).toBe(false);
    fireEvent.click(buscar);
    await vi.waitFor(() => {
      const body = lastSearchBody() as Record<string, unknown>;
      expect(body).toMatchObject({
        source: 'AMAZON',
        mode: 'listing',
        amazonListing: { kind: 'mega' },
      });
      expect(body.query).toBeUndefined();
    });
  });
});
