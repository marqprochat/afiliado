import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  describe('compartilhar com outros lotes', () => {
    const productItem = (id: string, order: number, productId: string, title: string) => ({
      ...baseItem,
      id,
      order,
      status: 'PENDING',
      productId,
      product: { title, images: [] },
    });
    const running = {
      ...batch,
      status: 'RUNNING',
      items: [
        productItem('i1', 0, 'p1', 'Fone Bluetooth'),
        productItem('i2', 1, 'p2', 'Mouse Gamer'),
        { ...baseItem, id: 'i3', order: 2, status: 'PENDING', customText: 'Aviso' },
      ],
    };
    const summary = (id: string, name: string, status: string) => ({
      id,
      name,
      status,
      intervalMin: 5,
      mediaMode: 'IMAGE',
      shuffled: false,
      groupJids: [],
      telegramChatIds: [],
      estimatedEndAt: null,
      createdAt: '2026-10-12T10:00:00.000Z',
      total: 4,
      sent: 1,
      errors: 0,
    });

    function renderRunning() {
      apiFetchMock.mockImplementation(async (url: string, opts?: any) => {
        if (url === '/batches/b1') return running as never;
        if (url === '/batches') {
          return [
            summary('b1', 'Lote Origem', 'RUNNING'),
            summary('b2', 'Lote Destino', 'RUNNING'),
          ] as never;
        }
        if (url === '/batches/share' && opts?.method === 'POST') {
          return {
            results: [
              { batchId: 'b2', ok: true, added: 1, skipped: 0, reactivated: false, status: 'RUNNING', error: null },
            ],
          } as never;
        }
        return [] as never;
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <BatchManageDrawer batchId="b1" onClose={() => {}} />
        </QueryClientProvider>,
      );
    }

    it('lote rodando: checkbox só nos itens de produto e botão desabilitado sem seleção', async () => {
      renderRunning();
      expect(await screen.findByLabelText('Selecionar Fone Bluetooth')).toBeTruthy();
      expect(screen.getByLabelText('Selecionar Mouse Gamer')).toBeTruthy();
      expect(screen.getAllByRole('checkbox', { name: /^Selecionar / })).toHaveLength(2);
      expect(screen.getByRole('button', { name: /Compartilhar selecionados/ })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('compartilha os selecionados com outro lote sem pausar o de origem', async () => {
      renderRunning();
      fireEvent.click(await screen.findByLabelText('Selecionar Fone Bluetooth'));
      fireEvent.click(screen.getByRole('button', { name: 'Compartilhar selecionados (1)' }));

      // o lote de origem não aparece como destino
      expect(await screen.findByLabelText('Lote Destino')).toBeTruthy();
      expect(screen.queryByLabelText('Lote Origem')).toBeNull();

      fireEvent.click(screen.getByLabelText('Lote Destino'));
      fireEvent.click(screen.getByRole('button', { name: /avançar/i }));
      fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledWith('/batches/share', {
          method: 'POST',
          json: { productIds: ['p1'], batchIds: ['b2'], position: 'end' },
        });
      });
      expect(apiFetchMock).not.toHaveBeenCalledWith('/batches/b1/pause', expect.anything());
    });
  });
});
