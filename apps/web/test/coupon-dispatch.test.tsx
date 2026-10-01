import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CuponsPage from '@/app/(app)/config/cupons/page';
import { formatSyncResults } from '@/components/coupons/sync-feedback';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const base = {
  tenantId: 't1', scope: '', advertiserName: null, terms: null, discountType: 'PERCENT', discountValue: 10,
  minSpend: null, startsAt: null, origin: 'MANUAL', sourceUrl: null, affiliateUrl: null, externalId: null,
  remainingUses: null, lastSeenAt: null, lastVerifiedAt: null, fetchedAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z',
};
const coupons = [
  { ...base, id: 'c1', store: 'SHOPEE', code: 'PROMO10', description: '10% off', status: 'VALID', expiresAt: null },
  { ...base, id: 'c2', store: 'AMAZON', code: 'AMZ5', description: '5% off', status: 'UNVERIFIED', expiresAt: null },
  { ...base, id: 'c3', store: 'SHOPEE', code: 'VELHO', description: 'expirado', status: 'EXPIRED', expiresAt: '2020-01-01T00:00:00.000Z' },
];
const sessions = [{ id: 's1', label: 'Chip', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' }];
const groups = [{ id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 1 }];
const templates = [{ id: 'tc', name: 'Cupom A', body: '{codigo}', isDefault: false, kind: 'COUPON' }];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CuponsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/coupons/dispatch') {
      return { batchId: 'b1', name: 'Cupons 30/09 14:00', mode: 'queue', itemCount: 2, firstRunAt: new Date().toISOString(), skipped: [] } as never;
    }
    if (url.startsWith('/coupons')) return { coupons } as never;
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/')) return groups as never;
    if (url === '/telegram/chats') return [] as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
});

describe('seleção e despacho de cupons', () => {
  it('cupom expirado não é selecionável', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    expect((screen.getByLabelText('Selecionar cupom VELHO') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Selecionar cupom PROMO10') as HTMLInputElement).disabled).toBe(false);
  });

  it('a barra só aparece com seleção e mostra a contagem', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    expect(screen.queryByText(/selecionado/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    expect(await screen.findByText('1 cupom selecionado')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Selecionar cupom AMZ5'));
    expect(await screen.findByText('2 cupons selecionados')).toBeDefined();
  });

  it('"selecionar todos" marca só os elegíveis', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar todos os cupons'));
    expect(await screen.findByText('2 cupons selecionados')).toBeDefined();
  });

  it('"Colocar na fila" envia os ids, o template, os grupos e o modo queue', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    fireEvent.click(screen.getByLabelText('Selecionar cupom AMZ5'));
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    const queueBtn = screen.getByRole('button', { name: 'Colocar na fila' });
    await waitFor(() => expect((queueBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(queueBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/coupons/dispatch',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            couponIds: ['c1', 'c2'],
            templateId: 'tc',
            sessionId: 's1',
            groupJids: ['g1@g.us'],
            mode: 'queue',
          }),
        }),
      );
    });
  });

  it('"Enviar agora" usa mode now e fica desabilitado sem grupo', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    const nowBtn = await screen.findByRole('button', { name: 'Enviar agora' });
    expect((nowBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    await waitFor(() => expect((nowBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nowBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/coupons/dispatch',
        expect.objectContaining({ json: expect.objectContaining({ mode: 'now' }) }),
      );
    });
  });
});

describe('formatSyncResults', () => {
  it('resume cada fonte e destaca erro', () => {
    expect(
      formatSyncResults([
        { source: 'ALIEXPRESS', ok: true, created: 3, updated: 1, expired: 0 },
        { source: 'AWIN', ok: false, created: 0, updated: 0, expired: 0, error: 'token inválido' },
        { source: 'EXPIRY', ok: true, created: 0, updated: 0, expired: 2 },
      ]),
    ).toBe(
      'AliExpress: 3 novos, 1 atualizado · Awin: erro — token inválido · Expiração: 2 expirados',
    );
  });
  it('sem resultados devolve texto padrão', () => {
    expect(formatSyncResults(undefined)).toBe('Cupons sincronizados com sucesso!');
  });
});
