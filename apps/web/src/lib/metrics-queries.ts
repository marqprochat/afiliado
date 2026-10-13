'use client';
import { useQuery } from '@tanstack/react-query';
import type {
  MetricsAutomation,
  MetricsClicks,
  MetricsGroups,
  MetricsOverview,
  MetricsProducts,
  MetricsSends,
} from '@afilados/shared';
import { apiFetch } from './api';
import { filtersToApiQuery, type MetricsFilters } from './metrics-filters';

export const METRICS_STALE_TIME = 60_000;

type Panel = 'overview' | 'groups' | 'sends' | 'products' | 'clicks' | 'automation';

function useMetricsPanel<T>(panel: Panel, filters: MetricsFilters) {
  const qs = filtersToApiQuery(filters);
  return useQuery({
    queryKey: ['metrics', panel, qs],
    queryFn: () => apiFetch<T>(`/metrics/${panel}?${qs}`),
    staleTime: METRICS_STALE_TIME,
  });
}

export const useMetricsOverview = (f: MetricsFilters) =>
  useMetricsPanel<MetricsOverview>('overview', f);
export const useMetricsGroups = (f: MetricsFilters) => useMetricsPanel<MetricsGroups>('groups', f);
export const useMetricsSends = (f: MetricsFilters) => useMetricsPanel<MetricsSends>('sends', f);
export const useMetricsProducts = (f: MetricsFilters) =>
  useMetricsPanel<MetricsProducts>('products', f);
export const useMetricsClicks = (f: MetricsFilters) => useMetricsPanel<MetricsClicks>('clicks', f);
export const useMetricsAutomation = (f: MetricsFilters) =>
  useMetricsPanel<MetricsAutomation>('automation', f);
