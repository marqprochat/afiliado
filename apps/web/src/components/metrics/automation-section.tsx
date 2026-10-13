'use client';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsAutomation } from '@afilados/shared';
import { formatDayLabel, formatInt } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

function StatGroup({
  title,
  stats,
}: {
  title: string;
  stats: { label: string; value: number; testId: string }[];
}) {
  return (
    <div role="group" aria-label={title} className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <dl className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.testId}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd data-testid={s.testId} className="text-xl font-bold">
              {formatInt(s.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AutomationSection({ query }: { query: PanelQuery<MetricsAutomation> }) {
  const data = query.data;
  const isEmpty =
    !!data &&
    [
      ...Object.values(data.mirror),
      ...Object.values(data.automation),
      ...Object.values(data.coupons),
    ].every((n) => n === 0);
  return (
    <MetricsSection
      id="automacoes"
      title="Espelhamento e automações"
      query={query}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma atividade de espelhamento, automação ou cupons no período."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatGroup
              title="Espelhamento"
              stats={[
                { label: 'Capturadas', value: data.mirror.captured, testId: 'auto-captured' },
                { label: 'Espelhadas', value: data.mirror.mirrored, testId: 'auto-mirrored' },
                { label: 'Descartadas', value: data.mirror.discarded, testId: 'auto-discarded' },
                { label: 'Erros', value: data.mirror.errors, testId: 'auto-mirror-errors' },
              ]}
            />
            <StatGroup
              title="Automações"
              stats={[
                {
                  label: 'Descobertas',
                  value: data.automation.discovered,
                  testId: 'auto-discovered',
                },
                {
                  label: 'Disparadas',
                  value: data.automation.dispatched,
                  testId: 'auto-dispatched',
                },
                { label: 'Ignoradas', value: data.automation.skipped, testId: 'auto-skipped' },
                { label: 'Erros', value: data.automation.errors, testId: 'auto-errors' },
              ]}
            />
            <StatGroup
              title="Cupons"
              stats={[
                { label: 'Validados', value: data.coupons.validated, testId: 'auto-validated' },
                { label: 'Propagados', value: data.coupons.propagated, testId: 'auto-propagated' },
              ]}
            />
          </div>
          <ChartBox title="Espelhadas e disparadas por dia">
            <BarChart data={data.daily}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
              <YAxis allowDecimals={false} {...AXIS_PROPS} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(d) => formatDayLabel(String(d))}
              />
              <Legend />
              <Bar dataKey="mirrored" name="Espelhadas" fill={CHART_COLORS.info} />
              <Bar dataKey="dispatched" name="Disparadas pela automação" fill={CHART_COLORS.warn} />
            </BarChart>
          </ChartBox>
        </div>
      )}
    </MetricsSection>
  );
}
