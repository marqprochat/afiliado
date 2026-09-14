import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchFilters } from '@/components/products/search-filters';

describe('SearchFilters', () => {
  it('monta SearchQuery de keyword com defaults', () => {
    const onSearch = vi.fn();
    render(<SearchFilters mode="keyword" onSearch={onSearch} />);
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
    });
  });
  it('trending não exige texto', () => {
    const onSearch = vi.fn();
    render(<SearchFilters mode="trending" onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'trending' }));
  });
});
