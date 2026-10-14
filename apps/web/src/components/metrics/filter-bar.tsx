'use client';
import { useState } from 'react';
import type { MetricsGroupOption, MetricsPeriod } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MetricsFilters } from '@/lib/metrics-filters';

const ALL_GROUPS = '__all__';

type QuickPeriod = Exclude<MetricsPeriod, 'custom'>;

const PERIODS: { value: QuickPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

const fieldClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30';

export function FilterBar({
  filters,
  groupOptions,
  onPeriod,
  onCustom,
  onGroup,
}: {
  filters: MetricsFilters;
  groupOptions: MetricsGroupOption[];
  onPeriod: (period: QuickPeriod) => void;
  onCustom: (fromDay: string, toDay: string) => void;
  onGroup: (groupJid: string | null) => void;
}) {
  const [customOpen, setCustomOpen] = useState(filters.period === 'custom');
  const [fromDay, setFromDay] = useState(filters.fromDay);
  const [toDay, setToDay] = useState(filters.toDay);
  const groupItems = [
    { value: ALL_GROUPS, label: 'Todos os grupos' },
    ...groupOptions.map((g) => ({ value: g.jid, label: g.name })),
  ];

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-border bg-background/95 py-3 backdrop-blur">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={filters.period === p.value ? 'default' : 'outline'}
            aria-pressed={filters.period === p.value}
            onClick={() => {
              setCustomOpen(false);
              onPeriod(p.value);
            }}
          >
            {p.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={filters.period === 'custom' ? 'default' : 'outline'}
          aria-pressed={filters.period === 'custom'}
          onClick={() => setCustomOpen(true)}
        >
          Personalizado
        </Button>
      </div>

      {customOpen && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (fromDay && toDay && fromDay <= toDay) onCustom(fromDay, toDay);
          }}
        >
          <input
            type="date"
            aria-label="Data inicial"
            className={fieldClass}
            value={fromDay}
            max={toDay}
            onChange={(e) => setFromDay(e.target.value)}
          />
          <input
            type="date"
            aria-label="Data final"
            className={fieldClass}
            value={toDay}
            min={fromDay}
            onChange={(e) => setToDay(e.target.value)}
          />
          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </form>
      )}

      <Select
        value={filters.groupJid ?? ALL_GROUPS}
        items={groupItems}
        onValueChange={(v) => onGroup(!v || v === ALL_GROUPS ? null : String(v))}
      >
        <SelectTrigger aria-label="Grupo" className="ml-auto min-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {groupItems.map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
