'use client';
import type { MetricsDelta, MetricsOverview } from '@afilados/shared';
import { formatInt, formatPct, formatSigned } from '@/lib/metrics-format';
import { MetricsSection, type PanelQuery } from './metrics-section';

type KpiKey = keyof MetricsOverview['kpis'];

const KPIS: { key: KpiKey; label: string; format: (n: number) => string; invert?: boolean }[] = [
  { key: 'members', label: 'Membros totais', format: formatInt },
  { key: 'joins', label: 'Entradas', format: formatInt },
  { key: 'leaves', label: 'Saídas', format: formatInt, invert: true },
  { key: 'net', label: 'Saldo líquido', format: formatSigned },
  { key: 'sends', label: 'Total de envios', format: formatInt },
  { key: 'successRate', label: 'Taxa de sucesso', format: formatPct },
  { key: 'clicks', label: 'Cliques em links', format: formatInt },
];

/** Seta + sinal + cor: a cor nunca é o único indicador. `invert` = subir é ruim (ex.: saídas). */
export function DeltaBadge({ delta, invert = false }: { delta: MetricsDelta; invert?: boolean }) {
  if (delta.changePct === null) {
    return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  }
  const up = delta.changePct > 0;
  const flat = delta.changePct === 0;
  const tone = flat ? 'neutral' : up !== invert ? 'good' : 'bad';
  const text = `${up ? '+' : ''}${formatPct(delta.changePct)}`;
  return (
    <span
      data-tone={tone}
      title="Variação em relação ao período anterior"
      className={
        tone === 'good'
          ? 'text-xs font-medium text-[var(--chart-1)]'
          : tone === 'bad'
            ? 'text-xs font-medium text-[var(--destructive)]'
            : 'text-xs font-medium text-muted-foreground'
      }
    >
      {up ? '▲' : flat ? '■' : '▼'} {text}
    </span>
  );
}

export function KpiCards({ query }: { query: PanelQuery<MetricsOverview> }) {
  const kpis = query.data?.kpis;
  return (
    <MetricsSection id="kpis" title="Indicadores" query={query} isEmpty={false} emptyMessage="">
      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {KPIS.map(({ key, label, format, invert }) => (
            <div
              key={key}
              role="group"
              aria-label={label}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
              <p data-testid={`kpi-${key}`} className="text-2xl font-bold">
                {format(kpis[key].current)}
              </p>
              <DeltaBadge delta={kpis[key]} invert={invert ?? false} />
            </div>
          ))}
        </div>
      )}
    </MetricsSection>
  );
}
