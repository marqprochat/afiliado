import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManualSendPage from '@/app/(app)/envio-manual/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const sessions = [{ id: 's1', label: 'Chip', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' }];
const groups = [{ id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 1 }];
const templates = [{ id: 'tc', name: 'Cupom A', body: '🎟️ {codigo}', isDefault: false, kind: 'COUPON' }];
const coupon = {
  id: 'c1', tenantId: 't1', store: 'SHOPEE', scope: '', advertiserName: null, code: 'PROMO10',
  description: '10% off', terms: null, discountType: 'PERCENT', discountValue: 10, minSpend: null,
  startsAt: null, expiresAt: null, status: 'VALID', origin: 'MANUAL', sourceUrl: null,
  affiliateUrl: null, externalId: null, remainingUses: null, lastSeenAt: null, lastVerifiedAt: null,
  fetchedAt: '', createdAt: '', updatedAt: '',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ManualSendPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/manual-send') {
      return { batchId: 'b1', name: 'Envio manual 30/09 14:00', mode: 'now', itemCount: 1, firstRunAt: new Date().toISOString(), skipped: [] } as never;
    }
    if (url === '/templates/preview') return { text: '🎟️ PROMO10' } as never;
    if (url.startsWith('/coupons')) return { coupons: [coupon] } as never;
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/')) return groups as never;
    if (url === '/telegram/chats') return [] as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
});

describe('página de envio manual', () => {
  it('botões ficam desabilitados sem texto e sem grupo', async () => {
    renderPage();
    const nowBtn = await screen.findByRole('button', { name: 'Enviar agora' });
    expect((nowBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('mostra a prévia do texto digitado', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: '*Olá* grupo' } });
    expect(screen.getByTestId('manual-preview').textContent).toContain('Olá');
  });

  it('envia agora com texto, imagem e destino', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'Aviso importante' } });
    fireEvent.change(screen.getByLabelText('Imagem (URL, opcional)'), {
      target: { value: 'https://img.example/a.jpg' },
    });
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    const nowBtn = screen.getByRole('button', { name: 'Enviar agora' });
    await waitFor(() => expect((nowBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nowBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/manual-send',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            text: 'Aviso importante',
            imageUrl: 'https://img.example/a.jpg',
            sessionId: 's1',
            groupJids: ['g1@g.us'],
            mode: 'now',
          }),
        }),
      );
    });
  });

  it('inserir cupom acrescenta o texto renderizado ao campo', async () => {
    renderPage();
    const field = (await screen.findByLabelText('Mensagem')) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Veja:' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Inserir cupom PROMO10' }));
    await waitFor(() => expect(field.value).toBe('Veja:\n\n🎟️ PROMO10'));
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/templates/preview',
      expect.objectContaining({
        json: { body: '🎟️ {codigo}', kind: 'COUPON', couponId: 'c1' },
      }),
    );
  });
});
