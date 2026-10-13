import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseMetricsFilters } from '@/lib/metrics-filters';
import { useMetricsSends } from '@/lib/metrics-queries';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

describe('useMetrics*', () => {
  it('chama a rota do painel com from/to/groupJid', async () => {
    apiFetchMock.mockResolvedValue({ ok: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const filters = parseMetricsFilters(
      new URLSearchParams('period=7d&groupJid=g1%40g.us'),
      new Date('2026-10-13T15:00:00Z'),
    );
    const { result } = renderHook(() => useMetricsSends(filters), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/metrics/sends?from=2026-10-07T03%3A00%3A00.000Z&to=2026-10-14T03%3A00%3A00.000Z&groupJid=g1%40g.us',
    );
  });
});
