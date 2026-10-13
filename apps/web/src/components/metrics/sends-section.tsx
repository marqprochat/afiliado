'use client';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsSends } from '@afilados/shared';
import { formatDayLabel, formatInt, formatPct } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function SendsHeatmap({ cells }: { cells: MetricsSends['heatmap'] }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-muted-foreground">
        Volume por dia da semana e hora
      </figcaption>
      <div
        role="grid"
        aria-label="Mapa de calor de envios"
        className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-px text-[10px]"
      >
        {WEEKDAYS.map((w, weekday) => (
          <div role="row" key={w} className="contents">
            <span role="rowheader" className="pr-1 text-muted-foreground">
              {w}
            </span>
            {cells
              .filter((c) => c.weekday === weekday)
              .map((c) => {
                const label = `${w} ${c.hour}h: ${c.count} envio(s)`;
                return (
                  <span
                    role="gridcell"
                    key={c.hour}
                    aria-label={label}
                    title={label}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: 'var(--chart-1)',
                      opacity: c.count === 0 ? 0.08 : 0.2 + 0.8 * (c.count / max),
                    }}
                  />
                );
              })}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function SendsSection({ query }: { query: PanelQuery<MetricsSends> }) {
  const data = query.data;
  return (
    <MetricsSection
      id="envios"
      title="Envios"
      query={query}
      isEmpty={!!data && data.totals.total === 0}
      emptyMessage="Nenhum envio no período."
    >
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {`${formatInt(data.totals.total)} envios · ${formatInt(data.totals.sent)} entregues · ${formatInt(data.totals.failed)} com falha · ${formatPct(data.totals.successRate)} de sucesso`}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Envios por dia">
              <BarChart data={data.daily}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Bar dataKey="sent" name="Entregues" stackId="s" fill={CHART_COLORS.primary} />
                <Bar dataKey="failed" name="Falhas" stackId="s" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
            <ChartBox title="Envios por hora do dia">
              <BarChart data={data.hourly}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(h) => `${h}h`} />
                <Legend />
                <Bar dataKey="sent" name="Entregues" stackId="h" fill={CHART_COLORS.primary} />
                <Bar dataKey="failed" name="Falhas" stackId="h" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SendsHeatmap cells={data.heatmap} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Principais erros</p>
              {data.topErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma falha no período.</p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {data.topErrors.map((e) => (
                    <li
                      key={e.error}
                      className="flex items-start justify-between gap-3 rounded-md border border-border px-2 py-1"
                    >
                      <span className="break-all">{e.error}</span>
                      <span className="font-semibold">{formatInt(e.count)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
