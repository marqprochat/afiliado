import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IaPage from '@/app/(app)/config/ia/page';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiClientError: class extends Error {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const settings = {
  enabled: false, baseUrl: 'https://vps.exemplo.com/v1', model: 'combo',
  hasApiKey: true, apiKeyHint: '••••1234',
  extraInstructions: '', tone: 'empolgado', emojiLevel: 'medio', maxChars: 140, temperature: 0.9,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IaPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/settings/ai') return settings as never;
    if (url === '/settings/ai/test') return { cta: 'Corre! 🔥', latencyMs: 300 } as never;
    return {} as never;
  });
});

describe('página Configurações > IA', () => {
  it('carrega a configuração e salva só o alterado via PUT', async () => {
    renderPage();
    const model = await screen.findByLabelText(/modelo/i);
    fireEvent.change(model, { target: { value: 'novo' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/settings/ai', { method: 'PUT', json: { model: 'novo' } }),
    );
  });
  it('Testar chama POST /settings/ai/test com o rascunho e mostra o CTA', async () => {
    renderPage();
    await screen.findByLabelText(/modelo/i);
    fireEvent.click(screen.getByRole('button', { name: /testar/i }));
    expect(await screen.findByText(/Corre! 🔥/)).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/settings/ai/test',
      expect.objectContaining({ method: 'POST', json: expect.objectContaining({ model: 'combo' }) }),
    );
  });
});
