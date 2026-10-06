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

  it('Colar URL: exige a URL e a envia aparada', () => {
    const onSearch = vi.fn();
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
    fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: 'url' } });
    const button = screen.getByRole('button', { name: /buscar/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL da listagem'), {
      target: { value: '  https://www.mercadolivre.com.br/mais-vendidos  ' },
    });
    fireEvent.click(button);
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/mais-vendidos' },
      }),
    );
  });

  describe('URL de listagem inválida', () => {
    const MSG = 'Cole a URL completa de uma listagem do Mercado Livre, começando com https://';

    function tentar(valor: string) {
      const onSearch = vi.fn();
      renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch });
      fireEvent.change(screen.getByLabelText('Fonte da listagem'), { target: { value: 'url' } });
      fireEvent.change(screen.getByLabelText('URL da listagem'), { target: { value: valor } });
      fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
      return onSearch;
    }

    it.each([
      ['domínio fora do Mercado Livre', 'https://evil.com/x'],
      ['texto que não é URL', 'not a url'],
      ['http em vez de https', 'http://www.mercadolivre.com.br/x'],
    ])('%s: não busca e mostra erro inline', (_nome, valor) => {
      const onSearch = tentar(valor);
      expect(onSearch).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe(MSG);
      expect(screen.getByLabelText('URL da listagem').getAttribute('aria-invalid')).toBe('true');
    });

    it('limpa o erro ao editar a URL e busca com a URL válida', () => {
      const onSearch = tentar('https://evil.com/x');
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('URL da listagem'), {
        target: { value: 'https://www.mercadolivre.com.br/mais-vendidos' },
      });
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
      expect(onSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/mais-vendidos' },
        }),
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });
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
  it('não mostra Vendas mín. na listagem (cards do ML não têm vendas), mas mantém em keyword', () => {
    renderFilters({ source: 'MERCADOLIVRE', mode: 'listing', onSearch: vi.fn() });
    expect(screen.queryByLabelText(/vendas mín/i)).toBeNull();
  });

  it('keyword continua com Vendas mín.', () => {
    renderFilters({ source: 'SHOPEE', mode: 'keyword', onSearch: vi.fn() });
    expect(screen.getByLabelText(/vendas mín/i)).toBeTruthy();
  });
});
