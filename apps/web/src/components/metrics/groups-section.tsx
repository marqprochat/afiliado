'use client';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricsGroupRow, MetricsGroups } from '@afilados/shared';
import {
  formatDateBR,
  formatDayLabel,
  formatInt,
  formatPct,
  formatSigned,
} from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

type SortKey = 'name' | 'members' | 'joins' | 'leaves' | 'net' | 'growthPct';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Grupo' },
  { key: 'members', label: 'Membros' },
  { key: 'joins', label: 'Entradas' },
  { key: 'leaves', label: 'Saídas' },
  { key: 'net', label: 'Saldo' },
  { key: 'growthPct', label: 'Crescimento' },
];

export function GroupsTable({ rows }: { rows: MetricsGroupRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'net',
    dir: 'desc',
  });
  const sorted = useMemo(() => {
    const value = (r: MetricsGroupRow) => r[sort.key] ?? Number.NEGATIVE_INFINITY;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv, 'pt-BR')
          : Number(av) - Number(bv);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className="px-2 py-2"
              >
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() =>
                    setSort((s) => ({
                      key: c.key,
                      dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc',
                    }))
                  }
                >
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.jid} className="border-t border-border">
              <td className="px-2 py-2">{r.name}</td>
              <td className="px-2 py-2">{formatInt(r.members)}</td>
              <td className="px-2 py-2">{formatInt(r.joins)}</td>
              <td className="px-2 py-2">{formatInt(r.leaves)}</td>
              <td className="px-2 py-2">{formatSigned(r.net)}</td>
              <td className="px-2 py-2">{r.growthPct === null ? '—' : formatPct(r.growthPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupsSection({ query }: { query: PanelQuery<MetricsGroups> }) {
  const data = query.data;
  const isEmpty =
    !!data && data.groups.length === 0 && data.totals.joins + data.totals.leaves === 0;
  const notice = data ? (
    <p
      role="note"
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      {data.trackingSince
        ? `Histórico de movimentação disponível a partir de ${formatDateBR(data.trackingSince)}`
        : 'A coleta do histórico de movimentação ainda não começou.'}
    </p>
  ) : null;

  return (
    <MetricsSection
      id="grupos"
      title="Grupos"
      query={query}
      isEmpty={isEmpty}
      emptyMessage="Nenhum grupo monitorado com movimentação no período. Só grupos em que o bot é administrador são acompanhados."
      notice={notice}
    >
      {data && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Evolução de membros">
              <AreaChart data={data.series}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="members"
                  name="Membros (snapshot)"
                  stroke={CHART_COLORS.primary}
                  fill={CHART_COLORS.primary}
                  fillOpacity={0.15}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeNet"
                  name="Saldo acumulado"
                  stroke={CHART_COLORS.info}
                  fill={CHART_COLORS.info}
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ChartBox>
            <ChartBox title="Entradas x saídas por dia">
              <BarChart data={data.series}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Bar dataKey="joins" name="Entradas" fill={CHART_COLORS.primary} />
                <Bar dataKey="leaves" name="Saídas" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
          </div>
          <GroupsTable rows={data.groups} />
        </div>
      )}
    </MetricsSection>
  );
}
