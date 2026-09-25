import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchFilters } from '@/components/products/search-filters';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));

function renderFilters(props: React.ComponentProps<typeof SearchFilters>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchFilters {...props} />
    </QueryClientProvider>,
  );
}

describe('SearchFilters', () => {
  it('monta SearchQuery de keyword com defaults', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'SHOPEE', mode: 'keyword', onSearch });
    fireEvent.change(screen.getByPlaceholderText(/palavra-chave/i), { target: { value: 'ryzen' } });
    fireEvent.click(screen.getByLabelText(/top vendedores/i));
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith({
      source: 'SHOPEE',
      mode: 'keyword',
      query: 'ryzen',
      sort: 'DISCOUNT_DESC',
      limit: 100,
      topSellers: true,
      extraCommission: false,
      freeShippingOnly: false,
    });
  });
  it('inclui filtros de preço/desconto quando preenchidos', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'SHOPEE', mode: 'keyword', onSearch });
    fireEvent.change(screen.getByPlaceholderText(/palavra-chave/i), { target: { value: 'fone' } });
    fireEvent.change(screen.getByLabelText(/preço mín/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/preço máx/i), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/desconto mín/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/só frete grátis/i));
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        minPrice: 20,
        maxPrice: 150,
        minDiscountPct: 30,
        freeShippingOnly: true,
      }),
    );
  });
  it('trending não exige texto', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'SHOPEE', mode: 'trending', onSearch });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'trending' }));
  });
});
