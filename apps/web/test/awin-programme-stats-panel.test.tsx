import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AwinProgrammeStatsPanel } from '@/components/marketplaces/awin-programme-stats-panel';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const item = (over: Record<string, unknown>) => ({
  advertiserId: '1',
  name: 'Loja',
  logoUrl: null,
  displayUrl: null,
  currency: 'BRL',
  epc: null,
  conversionRate: null,
  approvalPercentage: null,
  averagePaymentTime: null,
  validationDays: null,
  awinIndex: null,
  commissionMin: null,
  commissionMax: null,
  commissionType: null,
  score: null,
  fetchedAt: '2026-11-26T06:00:00.000Z',
  ...over,
});

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/marketplaces/awin/programme-stats') {
      return {
        fetchedAt: '2026-11-26T06:00:00.000Z',
        items: [
          item({ advertiserId: '1', name: 'Loja Sem EPC' }),
          item({
            advertiserId: '2',
            name: 'Drogal BR',
            epc: 0.42,
            conversionRate: 3.1,
            approvalPercentage: 90,
            averagePaymentTime: 45,
            commissionMin: 2,
            commissionMax: 8,
            commissionType: 'percentage',
            score: 0.378,
          }),
          item({ advertiserId: '3', name: 'Loja Top', epc: 1, score: 0.8 }),
        ],
      };
    }
    if (path === '/marketplaces/awin/programme-stats/refresh') return { queued: true };
    throw new Error(`unexpected call: ${path}`);
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AwinProgrammeStatsPanel />
    </QueryClientProvider>,
  );
}

describe('AwinProgrammeStatsPanel', () => {
  it('lista os programas ordenados por score com EPC, conversão, aprovação, prazo e comissão', async () => {
    renderPanel();
    const table = await screen.findByRole('table', { name: /indicadores dos programas/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([
      'Loja Top',
      'Drogal BR',
      'Loja Sem EPC',
    ]);
    const drogal = rows[1]!.textContent!.replace(/ /g, ' ');
    expect(drogal).toContain('R$ 0,42');
    expect(drogal).toContain('3,1%');
    expect(drogal).toContain('90%');
    expect(drogal).toContain('45 dias');
    expect(drogal).toContain('2% – 8%');
    expect(screen.getByText(/atualizado em/i).textContent).toMatch(/26\/11\/2026/);
  });

  it('"Atualizar indicadores" enfileira a atualização e avisa', async () => {
    renderPanel();
    await screen.findByRole('table', { name: /indicadores dos programas/i });
    fireEvent.click(screen.getByRole('button', { name: /atualizar indicadores/i }));
    await vi.waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/marketplaces/awin/programme-stats/refresh', {
        method: 'POST',
      }),
    );
    expect(await screen.findByText(/atualização na fila/i)).toBeTruthy();
  });

  it('sem indicadores mostra orientação', async () => {
    apiFetchMock.mockImplementation(async () => ({ items: [], fetchedAt: null }));
    renderPanel();
    expect(await screen.findByText(/nenhum indicador ainda/i)).toBeTruthy();
  });
});
