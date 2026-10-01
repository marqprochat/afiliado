import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { EMPTY_TARGET, type DispatchTarget } from '@/lib/dispatch-target';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const sessions = [
  { id: 's1', label: 'Chip 1', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
  { id: 's2', label: 'Chip 2', phone: null, status: 'DISCONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
];
const groups = [
  { id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 10 },
  { id: 'g3', jid: 'g3@g.us', name: 'Só membro', kind: 'GROUP', botIsAdmin: false, memberCount: 5 },
];
const templates = [
  { id: 'tp', name: 'Produto', body: '{titulo}', isDefault: true, kind: 'PRODUCT' },
  { id: 'tc1', name: 'Cupom A', body: '{codigo}', isDefault: false, kind: 'COUPON' },
  { id: 'tc2', name: 'Cupom B', body: '{codigo}', isDefault: false, kind: 'COUPON' },
];
const chats = [{ id: 'c1', botId: 'b1', chatId: '-100', title: 'Canal VIP', kind: 'channel', botIsAdmin: true, syncedAt: '' }];

function mockApi() {
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/') && url.endsWith('/groups')) return groups as never;
    if (url === '/telegram/chats') return chats as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
}

function renderPicker(value: DispatchTarget, onChange = vi.fn(), templateKind: 'COUPON' | null = 'COUPON') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DispatchTargetPicker value={value} onChange={onChange} templateKind={templateKind} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('DispatchTargetPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('escolhe a 1ª sessão conectada e o 1º template de cupom quando nada está definido', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ sessionId: 's1' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ templateId: 'tc1' }));
  });

  it('lista só templates do tipo pedido e só grupos em que o bot é admin', async () => {
    renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    await waitFor(() => expect(screen.getByLabelText('[GRUPO] Ofertas')).toBeDefined());
    expect(screen.queryByLabelText('[GRUPO] Só membro')).toBeNull();
    expect(screen.getByRole('option', { name: 'Cupom A' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Produto' })).toBeNull();
  });

  it('marcar um grupo emite a lista nova de groupJids', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    const box = await screen.findByLabelText('[GRUPO] Ofertas');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ groupJids: ['g1@g.us'] });
  });

  it('remove grupos selecionados que não existem mais', async () => {
    const onChange = renderPicker({
      ...EMPTY_TARGET,
      sessionId: 's1',
      templateId: 'tc1',
      groupJids: ['g1@g.us', 'apagado@g.us'],
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ groupJids: ['g1@g.us'] }));
  });

  it('sem templateKind não mostra o seletor de template', async () => {
    renderPicker({ ...EMPTY_TARGET, sessionId: 's1' }, vi.fn(), null);
    await screen.findByLabelText('[GRUPO] Ofertas');
    expect(screen.queryByLabelText('Template')).toBeNull();
  });

  it('marca chat do Telegram e altera o intervalo', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    fireEvent.click(await screen.findByLabelText('Canal VIP'));
    expect(onChange).toHaveBeenCalledWith({ telegramChatIds: ['-100'] });
    fireEvent.change(screen.getByLabelText('Intervalo na fila (min)'), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith({ intervalMin: 25 });
  });
});
