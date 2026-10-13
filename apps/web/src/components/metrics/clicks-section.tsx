'use client';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsClicks } from '@afilados/shared';
import { formatDayLabel, formatInt } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

export function ClicksSection({ query }: { query: PanelQuery<MetricsClicks> }) {
  const data = query.data;
  return (
    <MetricsSection
      id="cliques"
      title="Cliques"
      query={query}
      isEmpty={!!data && data.total === 0}
      emptyMessage="Nenhum clique nos links de grupos no período."
    >
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{`${formatInt(data.total)} cliques no período`}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Cliques por dia">
              <LineChart data={data.daily}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  name="Cliques"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartBox>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-2 py-2">
                      Link
                    </th>
                    <th scope="col" className="px-2 py-2">
                      Endereço
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Cliques
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLink.map((l) => (
                    <tr key={l.groupLinkId} className="border-t border-border">
                      <td className="px-2 py-2">{l.label}</td>
                      <td className="px-2 py-2 text-muted-foreground">{`/g/${l.slug}`}</td>
                      <td className="px-2 py-2 text-right font-semibold">{formatInt(l.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
