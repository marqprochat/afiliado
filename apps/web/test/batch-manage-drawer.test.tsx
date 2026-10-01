import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
