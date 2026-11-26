import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductImage } from '@/components/ui/product-image';
import { ProductCard } from '@/components/products/product-card';
import { DealCard, type DealCardProps } from '@/components/deals/deal-card';
import type { ApiProduct } from '@/lib/types';

describe('ProductImage', () => {
  it('mostra a imagem enquanto ela carrega normalmente', () => {
    render(<ProductImage src="https://img/x.jpg" alt="Fralda Pampers" />);
    expect(screen.getByRole('img', { name: 'Fralda Pampers' }).tagName).toBe('IMG');
    expect(screen.queryByTestId('product-image-placeholder')).not.toBeInTheDocument();
  });

  it('imagem quebrada vira placeholder neutro, sem texto alternativo visível', () => {
    render(<ProductImage src="https://img/quebrada.jpg" alt="Fralda Pampers" />);
    fireEvent.error(screen.getByRole('img', { name: 'Fralda Pampers' }));
    const placeholder = screen.getByTestId('product-image-placeholder');
    expect(placeholder).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    // alt continua acessível para leitor de tela
    expect(screen.getByRole('img', { name: 'Fralda Pampers' })).toBe(placeholder);
    expect(placeholder.querySelector('svg')).not.toBeNull();
  });

  it('sem src mostra o placeholder direto', () => {
    render(<ProductImage src={null} alt="Sem foto" />);
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
  });

  it('volta a tentar quando o src muda', () => {
    const { rerender } = render(<ProductImage src="https://img/a.jpg" alt="x" />);
    fireEvent.error(screen.getByRole('img', { name: 'x' }));
    rerender(<ProductImage src="https://img/b.jpg" alt="x" />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://img/b.jpg');
  });
});

describe('cards com imagem quebrada', () => {
  it('ProductCard (Buscar Produtos) mostra placeholder', () => {
    const p = {
      id: 'p1',
      source: 'AWIN',
      externalId: '1',
      title: 'Fralda',
      price: 10,
      originalPrice: null,
      discountPct: null,
      salesCount: null,
      commissionPct: null,
      images: ['https://img/quebrada.jpg'],
      shipping: 'UNKNOWN',
      flashSaleEndsAt: null,
      couponCode: null,
      originalUrl: 'https://www.awin1.com/pclick.php?p=1',
      shopId: null,
      shopName: null,
    } as unknown as ApiProduct;
    render(<ProductCard product={p} selected={false} onToggle={vi.fn()} onCopy={vi.fn()} />);
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
  });

  it('DealCard (vitrine) mostra placeholder', () => {
    const deal: DealCardProps = {
      id: 'd1',
      title: 'Fralda Pampers',
      cleanTitle: 'Fralda Pampers',
      slug: 'fralda-ab12',
      imageUrl: 'https://img/quebrada.jpg',
      currentBestPrice: 50,
      lowestPriceEver: 50,
      averagePrice30d: 50,
      listingsCount: 1,
      analysis: {
        badge: 'FAIR_PRICE',
        badgeLabel: 'Preço justo',
        averagePrice: 50,
        lowestPriceEver: 50,
        realDiscountPct: 0,
        isRealPromotion: false,
      },
      bestListing: null,
      availableStores: [],
    };
    render(<DealCard deal={deal} />);
    fireEvent.error(screen.getByRole('img', { name: 'Fralda Pampers' }));
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
  });
});
