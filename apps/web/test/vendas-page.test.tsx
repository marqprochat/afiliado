import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SalesList, SalesSummary } from '@afilados/shared';
import VendasPage from '@/app/(app)/vendas/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const summary: SalesSummary = {
  from: '2026-10-26T12:00:00.000Z',
  to: '2026-11-25T12:00:00.000Z',
  currencies: ['BRL'],
  totals: {
    commissionApproved: 11,
    commissionPending: 7,
    sales: 4,
    declined: 1,
    clicks: 7,
    conversion: 4 / 7,
  },
  byChannel: [
    {
      channelId: 'g1',
      channelKind: 'WHATSAPP',
      channelName: 'Grupo A',
      trackCode: 'wAAAA1',
      clicks: 4,
      sales: 2,
      commissionPending: 5,
      commissionApproved: 10,
      conversion: 0.5,
    },
    {
      channelId: null,
      channelKind: null,
      channelName: 'Sem canal identificado',
      trackCode: null,
      clicks: 2,
      sales: 1,
      commissionPending: 0,
      commissionApproved: 1,
      conversion: 0.5,
    },
  ],
  byAdvertiser: [
    {
      advertiserId: '9999',
      advertiserName: 'Loja A',
      sales: 3,
      saleAmount: 300,
      commissionPending: 2,
      commissionApproved: 11,
    },
  ],
  daily: [
    { date: '2026-11-01', sales: 1, commission: 10 },
    { date: '2026-11-02', sales: 0, commission: 0 },
  ],
};

const list: SalesList = {
  page: 1,
  pageSize: 20,
  total: 1,
  items: [
    {
      id: 's1',
      externalId: 'tx-1',
      advertiserId: '9999',
      advertiserName: 'Loja A',
      saleAmount: 100,
      commissionAmount: 10,
      currency: 'BRL',
      status: 'APPROVED',
      transactionDate: '2026-11-01T15:00:00.000Z',
      validationDate: null,
      channelKind: 'WHATSAPP',
      channelName: 'Grupo A',
      source: 'API',
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VendasPage />
    </QueryClientProvider>,
  );
}

describe('/vendas', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/sales/summary')) return summary;
      if (path.startsWith('/sales/awin-webhook')) {
        return {
          url: 'https://painel.test/api/v1/webhooks/awin/SEGREDO',
          path: '/api/v1/webhooks/awin/SEGREDO',
        };
      }
      if (path.startsWith('/sales?')) return list;
      return undefined;
    });
  });

  it('mostra os cartões do período (padrão 30 dias)', async () => {
    renderPage();
    const approved = await screen.findByRole('group', { name: 'Comissão aprovada' });
    expect(within(approved).getByText('R$ 11,00')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Comissão pendente' })).getByText('R$ 7,00'),
    ).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Vendas' })).getByText('4')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Cliques' })).getByText('7')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Conversão' })).getByText('57,1%'),
    ).toBeTruthy();
    const call = apiFetchMock.mock.calls.find(([p]) => String(p).startsWith('/sales/summary'));
    const qs = new URLSearchParams(String(call![0]).split('?')[1]);
    const days =
      (new Date(qs.get('to')!).getTime() - new Date(qs.get('from')!).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('mostra as tabelas por canal e por loja, a série diária e as últimas vendas', async () => {
    renderPage();
    const channels = await screen.findByRole('table', { name: 'Vendas por canal' });
    expect(within(channels).getByText('Grupo A')).toBeTruthy();
    expect(within(channels).getByText('Sem canal identificado')).toBeTruthy();
    expect(within(channels).getAllByText('50%')).toHaveLength(2);
    const stores = screen.getByRole('table', { name: 'Vendas por loja' });
    expect(within(stores).getByText('Loja A')).toBeTruthy();
    expect(screen.getByText('01/11')).toBeTruthy();
    const recent = await screen.findByRole('table', { name: 'Últimas vendas' });
    expect(within(recent).getByText('Aprovada')).toBeTruthy();
    expect(within(recent).getByText('R$ 10,00')).toBeTruthy();
  });

  it('bloco de notificações da Awin com a URL do webhook e o passo a passo', async () => {
    renderPage();
    expect(
      await screen.findByText('https://painel.test/api/v1/webhooks/awin/SEGREDO'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copiar URL/ })).toBeTruthy();
    expect(screen.getByText(/Transaction notifications/)).toBeTruthy();
  });
});
