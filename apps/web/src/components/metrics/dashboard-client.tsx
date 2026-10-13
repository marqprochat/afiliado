'use client';
import { useMetricsFilters } from '@/lib/use-metrics-filters';
import {
  useMetricsAutomation,
  useMetricsClicks,
  useMetricsGroups,
  useMetricsOverview,
  useMetricsProducts,
  useMetricsSends,
} from '@/lib/metrics-queries';
import { AutomationSection } from './automation-section';
import { ClicksSection } from './clicks-section';
import { FilterBar } from './filter-bar';
import { GroupsSection } from './groups-section';
import { KpiCards } from './kpi-cards';
import { ProductsSection } from './products-section';
import { SendsSection } from './sends-section';

export function DashboardClient() {
  const { filters, setPeriod, setCustom, setGroup } = useMetricsFilters();
  const overview = useMetricsOverview(filters);
  const groups = useMetricsGroups(filters);
  const sends = useMetricsSends(filters);
  const products = useMetricsProducts(filters);
  const clicks = useMetricsClicks(filters);
  const automation = useMetricsAutomation(filters);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard & Métricas</h1>
        <p className="text-sm text-muted-foreground">
          Variações comparadas ao período anterior de mesmo tamanho. Datas no fuso de São Paulo.
        </p>
      </header>
      <FilterBar
        key={`${filters.period}:${filters.fromDay}:${filters.toDay}`}
        filters={filters}
        groupOptions={overview.data?.groupOptions ?? []}
        onPeriod={setPeriod}
        onCustom={setCustom}
        onGroup={setGroup}
      />
      <KpiCards query={overview} />
      <GroupsSection query={groups} />
      <SendsSection query={sends} />
      <ProductsSection query={products} />
      <ClicksSection query={clicks} />
      <AutomationSection query={automation} />
    </div>
  );
}
