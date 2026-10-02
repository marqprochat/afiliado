import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BatchManageDrawer } from '@/components/queue/batch-manage-drawer';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const baseItem = {
  runAt: '2026-09-30T14:00:00.000Z',
  status: 'SENT',
  error: null,
  productId: null,
  product: null,
  coupon: null,
  customText: null,
  customImageUrl: null,
  sendLogs: [],
};
const longText = 'A'.repeat(80);
const batch = {
  id: 'b1',
  name: 'Envio manual 30/09 14:00',
  status: 'DONE',
  intervalMin: 1,
  mediaMode: 'FIRST',
  groupJids: [],
  telegramChatIds: [],
  estimatedEndAt: null,
  createdAt: '2026-09-30T14:00:00.000Z',
  sessionId: 's1',
  templateId: 't1',
  items: [
    { ...baseItem, id: 'i1', order: 0, customText: 'Aviso <b>importante</b>' },
    { ...baseItem, id: 'i2', order: 1, customText: longText },
    { ...baseItem, id: 'i3', order: 2 },
  ],
};

beforeEach(() => {
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/batches/b1') return batch as never;
    return [] as never;
  });
});

describe('BatchManageDrawer', () => {
  it('itens de mensagem livre mostram o texto; item vazio continua "Item removido"', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BatchManageDrawer batchId="b1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Mensagem: Aviso <b>importante</b>')).toBeTruthy();
    expect(screen.getByText(`Mensagem: ${'A'.repeat(60)}…`)).toBeTruthy();
    expect(screen.getAllByText('Item removido')).toHaveLength(1);
  });

  describe('lote pausado', () => {
    const paused = {
      ...batch,
      status: 'PAUSED',
      items: ['i1', 'i2', 'i3'].map((id, order) => ({
        ...baseItem,
        id,
        order,
        status: 'PENDING',
        customText: `Item ${id}`,
      })),
    };

    function renderPaused() {
      apiFetchMock.mockImplementation(async (url: string) => {
        if (url === '/batches/b1') return paused as never;
        return [] as never;
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <BatchManageDrawer batchId="b1" onClose={() => {}} />
        </QueryClientProvider>,
      );
    }
    const titles = () => screen.getAllByText(/^Mensagem: Item i\d$/).map((e) => e.textContent);

    it('botão "próximo envio" leva o item para o topo da fila', async () => {
      renderPaused();
      await screen.findByText('Mensagem: Item i1');
      const buttons = screen.getAllByRole('button', { name: /Enviar a seguir/ });
      expect(buttons[0]).toHaveProperty('disabled', true);
      fireEvent.click(buttons[2]!);
      expect(titles()).toEqual(['Mensagem: Item i3', 'Mensagem: Item i1', 'Mensagem: Item i2']);
      expect(await screen.findByRole('button', { name: 'Salvar ordem' })).toBeTruthy();
    });

    it('arrastar um item para outra posição reordena a fila', async () => {
      renderPaused();
      const first = (await screen.findByText('Mensagem: Item i1')).closest('li')!;
      const last = screen.getByText('Mensagem: Item i3').closest('li')!;
      // jsdom não implementa DataTransfer
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
      fireEvent.dragStart(first, { dataTransfer });
      fireEvent.dragOver(last, { dataTransfer });
      fireEvent.drop(last, { dataTransfer });
      expect(titles()).toEqual(['Mensagem: Item i2', 'Mensagem: Item i3', 'Mensagem: Item i1']);
    });
  });
});
