import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from '@/components/products/product-card';
import type { ApiProduct } from '@/lib/types';

const p: ApiProduct = {
  id: 'p1',
  source: 'SHOPEE',
  externalId: '1',
  title: 'Processador AMD Ryzen 5 5500',
  price: 848.48,
  originalPrice: 1194.99,
  discountPct: 29,
  salesCount: 6,
  commissionPct: 3,
  images: ['https://img/x.jpg'],
  shipping: 'UNKNOWN',
  flashSaleEndsAt: null,
  couponCode: null,
  originalUrl: 'https://shopee.com.br/product/1/1',
  shopId: '1',
  shopName: 'Loja',
};

describe('ProductCard', () => {
  it('mostra desconto, preços, vendas, comissão e alterna seleção', () => {
    const onToggle = vi.fn();
    render(<ProductCard product={p} selected={false} onToggle={onToggle} onCopy={vi.fn()} />);
    expect(screen.getByText('-29%')).toBeInTheDocument();
    expect(screen.getByText('R$ 848,48')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.194,99')).toBeInTheDocument();
    expect(screen.getByText(/6 vendidos/)).toBeInTheDocument();
    expect(screen.getByText(/3%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('p1');
  });
  it('copiar chama onCopy', () => {
    const onCopy = vi.fn();
    render(<ProductCard product={p} selected onToggle={vi.fn()} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: /copiar texto \+ link/i }));
    expect(onCopy).toHaveBeenCalledWith(p);
  });
});
