import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleCard } from '@/components/automations/rule-card';
import type { AutomationRule } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const baseRule: AutomationRule = {
  id: 'r1',
  name: 'Ofertas',
  enabled: true,
  marketplaces: ['SHOPEE'],
  keywords: ['fone'],
  blockedKeywords: [],
  minDiscountPct: null,
  minPrice: null,
  maxPrice: null,
  maxOffersPerDay: 20,
  intervalMin: 60,
  sessionId: 's1',
  groupJids: ['g@g.us'],
  templateId: 't1',
  mediaMode: 'IMAGE',
  createdAt: new Date().toISOString(),
  stats: {
    freshCount: 3,
    discoveredToday: 5,
    dispatchedToday: 2,
    lastDispatchedAt: null,
    isDiscovering: false,
  },
};

function renderCard(rule: AutomationRule) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RuleCard rule={rule} />
    </QueryClientProvider>,
  );
}

describe('RuleCard', () => {
  it('mostra "Enviados hoje" com o valor de dispatchedToday', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard(baseRule);
    const button = screen.getAllByRole('button')[0];
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText('Enviados hoje: 2')).toBeInTheDocument();
    });
  });

  it('mostra o selo "Buscando..." quando isDiscovering é true', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard({ ...baseRule, stats: { ...baseRule.stats, isDiscovering: true } });
    const button = screen.getAllByRole('button')[0];
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText('Buscando...')).toBeInTheDocument();
    });
  });

  it('não mostra o selo "Buscando..." quando isDiscovering é false', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderCard(baseRule);
    const button = screen.getAllByRole('button')[0];
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
    });
  });
});
