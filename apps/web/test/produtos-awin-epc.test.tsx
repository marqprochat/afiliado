import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProdutosPage from '@/app/(app)/produtos/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ useRealtime: () => {} }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const product = (id: string, shopName: string | null) => ({
  id,
  source: 'AWIN',
  externalId: `f:${id}`,
  title: `Produto ${id}`,
  price: 10,
  originalPrice: null,
  discountPct: null,
  salesCount: null,
  commissionPct: null,
  images: [],
  shipping: 'UNKNOWN',
  originalUrl: `https://www.awin1.com/cread.php?x=${id}`,
  affiliateUrl: null,
  shopId: null,
  shopName,
  couponCode: null,
  couponValue: null,
  flashSaleEndsAt: null,
  raw: {},
});

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/marketplaces') return [];
    if (path === '/queue') return { items: [], count: 0 };
    if (path === '/products/awin-stores') {
      return {
        stores: ['Loja Top', 'Drogal BR'],
        items: [
          { name: 'Loja Top', advertiserId: '3', epc: 1, currency: 'BRL', score: 0.8 },
          { name: 'Drogal BR', advertiserId: '2', epc: 0.42, currency: 'BRL', score: 0.38 },
        ],
      };
    }
    if (path === '/products/search') {
      return {
        products: [
          product('1', 'Drogal BR'),
          product('2', 'Sem Ranking'),
          product('3', 'Loja Top'),
          product('4', 'Drogal BR'),
        ],
      };
    }
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

const titles = () => screen.getAllByTitle(/^Produto \d$/).map((el) => el.getAttribute('title'));

describe('Buscar Produtos: Awin ordenado por EPC', () => {
  it('"Melhores lojas (EPC)" ordena pelo score da loja e mantém a ordem dentro da loja', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Awin' }));
    fireEvent.change(screen.getByPlaceholderText('Buscar por palavra-chave…'), {
      target: { value: 'fralda' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }));
    await screen.findByTitle('Produto 1');
    expect(titles()).toEqual(['Produto 1', 'Produto 2', 'Produto 3', 'Produto 4']);

    fireEvent.change(screen.getByLabelText(/ordenar resultados/i), {
      target: { value: 'store-epc' },
    });
    expect(titles()).toEqual(['Produto 3', 'Produto 1', 'Produto 4', 'Produto 2']);

    fireEvent.change(screen.getByLabelText(/ordenar resultados/i), {
      target: { value: 'search' },
    });
    expect(titles()).toEqual(['Produto 1', 'Produto 2', 'Produto 3', 'Produto 4']);
  });

  it('a ordenação por EPC não aparece fora da Awin', async () => {
    renderPage();
    expect(screen.queryByLabelText(/ordenar resultados/i)).toBeNull();
  });
});
