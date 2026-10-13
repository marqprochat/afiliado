'use client';
import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/** Só tokens do tema: os gráficos acompanham o modo claro/escuro. */
export const CHART_COLORS = {
  primary: 'var(--chart-1)',
  warn: 'var(--chart-2)',
  danger: 'var(--chart-3)',
  info: 'var(--chart-4)',
  accent: 'var(--chart-5)',
};
export const PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.info,
  CHART_COLORS.warn,
  CHART_COLORS.accent,
  CHART_COLORS.danger,
];
export const AXIS_PROPS = { stroke: 'var(--muted-foreground)', fontSize: 12 };
export const GRID_STROKE = 'var(--border)';
export const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  color: 'var(--popover-foreground)',
  borderRadius: 8,
};

export function ChartBox({
  title,
  height = 220,
  children,
}: {
  title: string;
  height?: number;
  children: ReactElement;
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-muted-foreground">{title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
