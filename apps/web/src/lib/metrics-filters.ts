import {
  METRICS_MAX_RANGE_DAYS,
  METRICS_PERIODS,
  customRange,
  periodRange,
  spAddDays,
  spDayKey,
  spDayKeysInRange,
  type MetricsPeriod,
} from '@afilados/shared';

export interface MetricsFilters {
  period: MetricsPeriod;
  /** dia de SP (YYYY-MM-DD), inclusivo */
  fromDay: string;
  /** dia de SP (YYYY-MM-DD), inclusivo */
  toDay: string;
  groupJid: string | null;
  from: Date;
  to: Date;
}

export const DEFAULT_PERIOD: Exclude<MetricsPeriod, 'custom'> = '30d';

const isDay = (d: string | null): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && spAddDays(d, 0) === d;

export function parseMetricsFilters(sp: URLSearchParams, now: Date): MetricsFilters {
  const groupJid = sp.get('groupJid') || null;
  const raw = sp.get('period') ?? '';
  const period = (METRICS_PERIODS as readonly string[]).includes(raw)
    ? (raw as MetricsPeriod)
    : DEFAULT_PERIOD;

  if (period === 'custom') {
    const fromDay = sp.get('from');
    const toDay = sp.get('to');
    if (isDay(fromDay) && isDay(toDay) && fromDay <= toDay) {
      const r = customRange(fromDay, toDay);
      if (spDayKeysInRange(r.from, r.to).length <= METRICS_MAX_RANGE_DAYS) {
        return { period, fromDay, toDay, groupJid, ...r };
      }
    }
  }

  const quick: Exclude<MetricsPeriod, 'custom'> = period === 'custom' ? DEFAULT_PERIOD : period;
  const r = periodRange(quick, now);
  return {
    period: quick,
    fromDay: spDayKey(r.from),
    toDay: spDayKey(new Date(r.to.getTime() - 1)),
    groupJid,
    ...r,
  };
}

/** Search params da página (o período padrão fica implícito). */
export function filtersToSearch(
  f: Pick<MetricsFilters, 'period' | 'fromDay' | 'toDay' | 'groupJid'>,
): string {
  const sp = new URLSearchParams();
  if (f.period !== DEFAULT_PERIOD) sp.set('period', f.period);
  if (f.period === 'custom') {
    sp.set('from', f.fromDay);
    sp.set('to', f.toDay);
  }
  if (f.groupJid) sp.set('groupJid', f.groupJid);
  return sp.toString();
}

/** Query string das rotas /metrics: instantes ISO + grupo. */
export function filtersToApiQuery(f: Pick<MetricsFilters, 'from' | 'to' | 'groupJid'>): string {
  const sp = new URLSearchParams({ from: f.from.toISOString(), to: f.to.toISOString() });
  if (f.groupJid) sp.set('groupJid', f.groupJid);
  return sp.toString();
}
