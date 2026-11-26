import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportPanel } from '@/components/products/import-panel';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  vi.mocked(copyToClipboard).mockClear();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/marketplaces/awin/links/batch') {
      return {
        items: [
          {
            input: 'https://www.drogal.com.br/a',
            url: 'https://www.awin1.com/cread.php?awinmid=68224&a=1',
            source: 'api',
          },
          {
            input: 'https://naoparceiro.com.br/x',
            url: null,
            error: 'O site "naoparceiro.com.br" não foi identificado como parceiro aprovado',
          },
        ],
      };
    }
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderPanel(source: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportPanel source={source} onImported={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ImportPanel: links da Awin em lote', () => {
  it('fora da Awin não mostra o botão de gerar links', () => {
    renderPanel('SHOPEE');
    expect(screen.queryByRole('button', { name: /gerar links awin/i })).toBeNull();
  });

  it('converte as URLs coladas numa chamada só e lista os resultados', async () => {
    renderPanel('AWIN');
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: 'https://www.drogal.com.br/a\nlixo sem url\nhttps://naoparceiro.com.br/x\nhttps://www.drogal.com.br/a',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /gerar links awin/i }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith('/marketplaces/awin/links/batch', {
      method: 'POST',
      json: {
        items: [{ url: 'https://www.drogal.com.br/a' }, { url: 'https://naoparceiro.com.br/x' }],
      },
    });
    expect(
      await screen.findByText('https://www.awin1.com/cread.php?awinmid=68224&a=1'),
    ).toBeTruthy();
    expect(screen.getByText(/não foi identificado como parceiro/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /copiar todos/i }));
    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(
        'https://www.awin1.com/cread.php?awinmid=68224&a=1',
      ),
    );
  });
});
