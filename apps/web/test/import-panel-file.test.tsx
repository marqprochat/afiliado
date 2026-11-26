import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportPanel } from '@/components/products/import-panel';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ products: [], unsupported: [] });
});

describe('ImportPanel: reenvio de planilha CSV/Excel', () => {
  it('limpa o input de arquivo após selecionar e permite enviar a mesma planilha várias vezes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onImported = vi.fn();
    const { container } = render(
      <QueryClientProvider client={client}>
        <ImportPanel source="SHOPEE" onImported={onImported} />
      </QueryClientProvider>,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File(['url,titulo\nhttps://shopee.com.br/x-i.1.2,SSD'], 'ofertas.csv', {
      type: 'text/csv',
    });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(onImported).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/enviar planilha/i)).toBeTruthy();
  });
});
