'use client';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import type { MetricsProducts } from '@afilados/shared';
import { MARKETPLACE_LABELS, formatInt } from '@/lib/metrics-format';
import { ChartBox, PALETTE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

const label = (source: string) => MARKETPLACE_LABELS[source] ?? source;

export function ProductsSection({ query }: { query: PanelQuery<MetricsProducts> }) {
  const data = query.data;
  const slices = (data?.byMarketplace ?? []).map((m) => ({
    name: label(m.source),
    value: m.sends,
  }));
  return (
    <MetricsSection
      id="produtos"
      title="Produtos"
      query={query}
      isEmpty={!!data && data.top.length === 0}
      emptyMessage="Nenhum produto enviado no período."
    >
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Top 10 mais enviados</p>
            <ol className="space-y-1 text-sm">
              {data.top.map((p, i) => (
                <li
                  key={p.productId}
                  className="flex items-center gap-3 rounded-md border border-border px-2 py-1"
                >
                  <span className="w-5 text-right text-muted-foreground">{i + 1}.</span>
                  {p.image ? (
                    <img src={p.image} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <span className="size-8 rounded bg-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={p.title}>
                    {p.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{label(p.source)}</span>
                  <span className="font-semibold">{formatInt(p.sends)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <ChartBox title="Envios por marketplace">
              <PieChart>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                  {slices.map((s, i) => (
                    <Cell key={s.name} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartBox>
            <ul className="flex flex-wrap gap-3 text-xs">
              {slices.map((s, i) => (
                <li key={s.name} className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  {`${s.name}: ${formatInt(s.value)}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
