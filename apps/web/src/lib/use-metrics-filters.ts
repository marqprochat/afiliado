'use client';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MetricsPeriod } from '@afilados/shared';
import { filtersToSearch, parseMetricsFilters, type MetricsFilters } from './metrics-filters';

export function useMetricsFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();
  const filters = useMemo(
    () => parseMetricsFilters(new URLSearchParams(search), new Date()),
    [search],
  );

  const navigate = useCallback(
    (next: Pick<MetricsFilters, 'period' | 'fromDay' | 'toDay' | 'groupJid'>) => {
      const qs = filtersToSearch(next);
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  return {
    filters,
    setPeriod: (period: Exclude<MetricsPeriod, 'custom'>) => navigate({ ...filters, period }),
    setCustom: (fromDay: string, toDay: string) =>
      navigate({ ...filters, period: 'custom', fromDay, toDay }),
    setGroup: (groupJid: string | null) => navigate({ ...filters, groupJid }),
  };
}
