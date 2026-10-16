import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AffiliateMarketplaces } from '@/components/marketplaces/affiliate-marketplaces';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const kinds = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU', 'AWIN', 'ALIEXPRESS'];
const list = kinds.map((kind) => ({ kind, status: 'OK', subId: kind === 'SHOPEE' ? 'joao' : null }));

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => (path === '/marketplaces' ? list : { ok: true }));
});
function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AffiliateMarketplaces /></QueryClientProvider>);
}

describe('AffiliateMarketplaces', () => {
  it('mostra um campo por plataforma, sem credenciais, e avisa quando falta o identificador', async () => {
    renderIt();
    expect(await screen.findAllByRole('textbox')).toHaveLength(6);
    expect((screen.getByLabelText(/subid.*shopee/i) as HTMLInputElement).value).toBe('joao');
    expect(screen.queryByLabelText(/secret|app id|senha/i)).toBeNull();
    expect(screen.getAllByText(/não será atribuída a você/i).length).toBe(5);
  });
  it('salva o identificador de uma plataforma', async () => {
    renderIt();
    const input = await screen.findByLabelText(/tracking id.*amazon/i);
    fireEvent.change(input, { target: { value: 'joao-20' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar amazon/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/marketplaces/AMAZON', { method: 'PUT', json: { subId: 'joao-20' } }),
    );
  });
});
