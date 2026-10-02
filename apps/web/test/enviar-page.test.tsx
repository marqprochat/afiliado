import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EnviarPage from '@/app/(app)/enviar/page';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  ApiClientError: class extends Error {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

const apiFetchMock = vi.mocked(apiFetch);

const mockQueue = {
  count: 2,
  limit: 500,
  items: [
    {
      id: 'q1',
      productId: 'p1',
      selected: true,
      status: 'PENDING',
      addedAt: '2026-10-02T10:00:00.000Z',
      product: {
        id: 'p1',
        source: 'SHOPEE',
        externalId: 'ext-1',
        title: 'Fone Bluetooth',
        price: 99.9,
        originalPrice: 199.9,
        discountPct: 50,
        salesCount: 100,
        commissionPct: 10,
        images: ['https://example.com/p1.jpg'],
        shipping: 'FREE',
        flashSaleEndsAt: null,
        couponCode: null,
        originalUrl: 'https://shopee.com.br/1',
        shopId: null,
        shopName: null,
      },
    },
    {
      id: 'q2',
      productId: 'p2',
      selected: true,
      status: 'PENDING',
      addedAt: '2026-10-02T10:05:00.000Z',
      product: {
        id: 'p2',
        source: 'AMAZON',
        externalId: 'ext-2',
        title: 'Mouse Gamer',
        price: 49.9,
        originalPrice: null,
        discountPct: null,
        salesCount: null,
        commissionPct: null,
        images: [],
        shipping: 'UNKNOWN',
        flashSaleEndsAt: null,
        couponCode: null,
        originalUrl: 'https://amazon.com.br/2',
        shopId: null,
        shopName: null,
      },
    },
  ],
};

const mockBatches = [
  {
    id: 'batch-123',
    name: 'Lote Principal',
    status: 'RUNNING',
    intervalMin: 10,
    mediaMode: 'IMAGE',
    shuffled: false,
    groupJids: ['g1@g.us'],
    telegramChatIds: [],
    estimatedEndAt: '2026-10-02T15:00:00.000Z',
    createdAt: '2026-10-02T10:00:00.000Z',
    total: 10,
    sent: 4,
    errors: 0,
  },
  {
    id: 'batch-done',
    name: 'Lote Antigo',
    status: 'DONE',
    intervalMin: 15,
    mediaMode: 'IMAGE',
    shuffled: false,
    groupJids: ['g1@g.us'],
    telegramChatIds: [],
    estimatedEndAt: '2026-10-02T11:00:00.000Z',
    createdAt: '2026-10-02T09:00:00.000Z',
    total: 5,
    sent: 5,
    errors: 0,
  },
];

const mockSessions = [
  {
    id: 's1',
    label: 'Chip WhatsApp',
    phone: '5511999999999',
    status: 'CONNECTED',
    lastQr: null,
    pairCode: null,
    lastSeenAt: null,
    createdAt: '',
  },
];

const mockTemplates = [{ id: 't1', name: 'Padrão', body: '{link}', isDefault: true }];

const mockSettings = {
  window: { startTime: '00:00', endTime: '23:59', timezone: 'America/Sao_Paulo', enabled: true },
  queueLimit: 500,
  globalRateLimitPerMin: 6,
  subIdPattern: 'x',
};

function renderEnviarPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <EnviarPage />
    </QueryClientProvider>,
  );
}

describe('EnviarPage - integração Trazer selecionados para lote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/queue') return mockQueue;
      if (path === '/batches') return mockBatches;
      if (path === '/sessions') return mockSessions;
      if (path.startsWith('/templates')) return mockTemplates;
      if (path === '/settings') return mockSettings;
      if (path.startsWith('/groups')) return [];
      if (path.startsWith('/telegram/chats')) return [];
      return [];
    });
  });

  it('abre o modal ao clicar em "Trazer selecionados para lote", escolhe lote e posição e envia POST', async () => {
    apiFetchMock.mockImplementation(async (path: string, options?: any) => {
      if (path === '/queue') return mockQueue;
      if (path === '/batches') return mockBatches;
      if (path === '/sessions') return mockSessions;
      if (path.startsWith('/templates')) return mockTemplates;
      if (path === '/settings') return mockSettings;
      if (path.startsWith('/groups')) return [];
      if (path.startsWith('/telegram/chats')) return [];
      if (path === '/batches/batch-123/send-products' && options?.method === 'POST') {
        return {
          added: 2,
          skipped: 0,
          status: 'RUNNING',
          estimatedEndAt: '2026-10-02T16:00:00.000Z',
          reactivated: false,
        };
      }
      return [];
    });

    renderEnviarPage();

    expect(await screen.findByText('Fone Bluetooth')).toBeInTheDocument();

    const openModalBtn = screen.getByRole('button', { name: /trazer selecionados para lote/i });
    expect(openModalBtn).toBeEnabled();
    fireEvent.click(openModalBtn);

    // Modal aberto no passo 1
    expect(await screen.findByText(/Enviar produtos para lote/i)).toBeInTheDocument();
    const batchRadio = screen.getByLabelText('Lote Principal');
    expect(batchRadio).toBeInTheDocument();

    // Seleciona lote
    fireEvent.click(batchRadio);
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Passo 2
    expect(await screen.findByText(/Enviar 2 produto\(s\) para «Lote Principal»/i)).toBeInTheDocument();

    // Escolhe posição: Começo da fila
    fireEvent.click(screen.getByLabelText(/começo da fila/i));

    // Confirma envio
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/batches/batch-123/send-products', {
        method: 'POST',
        json: {
          productIds: ['p1', 'p2'],
          position: 'start',
        },
      });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('2 adicionado(s)');
    });
  });

  it('mostra mensagem com ignorados no toast quando skipped > 0', async () => {
    apiFetchMock.mockImplementation(async (path: string, options?: any) => {
      if (path === '/queue') return mockQueue;
      if (path === '/batches') return mockBatches;
      if (path === '/sessions') return mockSessions;
      if (path.startsWith('/templates')) return mockTemplates;
      if (path === '/settings') return mockSettings;
      if (path.startsWith('/groups')) return [];
      if (path.startsWith('/telegram/chats')) return [];
      if (path === '/batches/batch-123/send-products' && options?.method === 'POST') {
        return {
          added: 1,
          skipped: 1,
          status: 'RUNNING',
          estimatedEndAt: '2026-10-02T16:00:00.000Z',
          reactivated: false,
        };
      }
      return [];
    });

    renderEnviarPage();

    expect(await screen.findByText('Fone Bluetooth')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /trazer selecionados para lote/i }));
    fireEvent.click(await screen.findByLabelText('Lote Principal'));
    fireEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Confirma com posição padrão 'end'
    fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/batches/batch-123/send-products', {
        method: 'POST',
        json: {
          productIds: ['p1', 'p2'],
          position: 'end',
        },
      });
      expect(toast.success).toHaveBeenCalledWith('1 adicionado(s) (1 ignorado(s))');
    });
  });
});
