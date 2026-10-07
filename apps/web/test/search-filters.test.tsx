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

describe('SearchFilters: listagem do Mercado Livre', () => {
  it('Ofertas do dia: emite mlListing deals', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith({
      source: 'MERCADOLIVRE',
      mode: 'listing',
      mlListing: { kind: 'deals' },
      sort: 'DISCOUNT_DESC',
      limit: 100,
      topSellers: false,
      extraCommission: false,
      freeShippingOnly: false,
    });
  });

  it('Categoria: só habilita a busca depois de escolher a categoria', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: 'category' } });
    const button = screen.getByRole('button', { name: /buscar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Categoria do ML'), { target: { value: 'MLB1051' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ mlListing: { kind: 'category', categoryId: 'MLB1051' } }),
    );
  });

  it('não oferece mais a colagem de URL de listagem (a extensão já cobre esse caso)', () => {
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch: vi.fn() });
    const options = [...screen.getByLabelText('Fonte da listagem').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['Ofertas do dia', 'Ofertas por categoria', 'Ofertas relâmpago']);
    expect(screen.queryByLabelText('URL da listagem')).toBeNull();
  });

  it('inclui o desconto mínimo junto com a listagem', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), {
      target: { value: 'lightning' },
    });
    fireEvent.change(screen.getByLabelText(/desconto mín/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ mlListing: { kind: 'lightning' }, minDiscountPct: 30 }),
    );
  });
  it.each([['deals'], ['category'], ['lightning']])(
    'palavra-chave opcional vale em "%s" e vai como query aparada',
    (kind) => {
      const onSearch = vi.fn();
      renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
      fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: kind } });
      if (kind === 'category') {
        fireEvent.change(screen.getByLabelText('Categoria do ML'), {
          target: { value: 'MLB1051' },
        });
      }
      fireEvent.change(screen.getByLabelText('Palavra-chave (opcional)'), {
        target: { value: '  fone bluetooth ' },
      });
      fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
      expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'fone bluetooth' }));
    },
  );

  it('sem palavra-chave não envia query (o campo é opcional e não trava a busca)', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch.mock.calls[0]?.[0]).not.toHaveProperty('query');
  });

  it('não mostra Vendas mín. na listagem (cards do ML não têm vendas), mas mantém em keyword', () => {
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch: vi.fn() });
    expect(screen.queryByLabelText(/vendas mín/i)).toBeNull();
  });

  it('keyword continua com Vendas mín.', () => {
    renderFilters({ source: 'SHOPEE', mode: 'keyword', onSearch: vi.fn() });
    expect(screen.getByLabelText(/vendas mín/i)).toBeTruthy();
  });
});
