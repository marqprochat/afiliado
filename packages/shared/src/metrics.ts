import { z } from 'zod';

export const METRICS_TIMEZONE = 'America/Sao_Paulo';
export const METRICS_MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export const METRICS_PERIODS = ['today', '7d', '30d', '90d', 'custom'] as const;
export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

/** `from` inclusivo, `to` exclusivo. */
export interface MetricsQuery {
  from: Date;
  to: Date;
  groupJid?: string;
}

export const metricsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    groupJid: z.string().trim().min(1).max(128).optional(),
  })
  .transform((v): MetricsQuery => {
    const q: MetricsQuery = { from: new Date(v.from), to: new Date(v.to) };
    if (v.groupJid) q.groupJid = v.groupJid;
    return q;
  })
  .refine((q) => q.to.getTime() > q.from.getTime(), {
    message: 'to deve ser posterior a from',
    path: ['to'],
  })
  .refine((q) => q.to.getTime() - q.from.getTime() <= METRICS_MAX_RANGE_DAYS * DAY_MS, {
    message: `intervalo máximo de ${METRICS_MAX_RANGE_DAYS} dias`,
    path: ['to'],
  });

// ---------- Datas no fuso de São Paulo ----------

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: METRICS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: METRICS_TIMEZONE,
  timeZoneName: 'longOffset',
});

/** Deslocamento de SP em minutos naquele instante (ex.: -180). */
function spOffsetMinutes(at: Date): number {
  const name = offsetFormatter.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function parseDayKey(dayKey: string): [number, number, number] {
  const [y, m, d] = dayKey.split('-').map(Number);
  return [y!, m!, d!];
}

/** Dia local de SP no formato `YYYY-MM-DD`. */
export function spDayKey(d: Date): string {
  return dayFormatter.format(d);
}

/** Instante UTC da meia-noite de SP do dia informado. */
export function spMidnight(dayKey: string): Date {
  const [y, m, d] = parseDayKey(dayKey);
  const offset = spOffsetMinutes(new Date(Date.UTC(y, m - 1, d, 12)));
  return new Date(Date.UTC(y, m - 1, d) - offset * 60_000);
}

export function spAddDays(dayKey: string, n: number): string {
  const [y, m, d] = parseDayKey(dayKey);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dias locais de SP cobertos por [from, to). */
export function spDayKeysInRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = spDayKey(new Date(to.getTime() - 1));
  for (let k = spDayKey(from); k <= last; k = spAddDays(k, 1)) out.push(k);
  return out;
}

export function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from.getTime()) };
}

const PERIOD_DAYS: Record<Exclude<MetricsPeriod, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Últimos N dias de SP, incluindo hoje: [meia-noite de N-1 dias atrás, meia-noite de amanhã). */
export function periodRange(
  period: Exclude<MetricsPeriod, 'custom'>,
  now: Date,
): { from: Date; to: Date } {
  const today = spDayKey(now);
  return {
    from: spMidnight(spAddDays(today, -(PERIOD_DAYS[period] - 1))),
    to: spMidnight(spAddDays(today, 1)),
  };
}

/** Intervalo personalizado com `toDay` inclusivo. */
export function customRange(fromDay: string, toDay: string): { from: Date; to: Date } {
  return { from: spMidnight(fromDay), to: spMidnight(spAddDays(toDay, 1)) };
}

// ---------- Respostas da API ----------

export interface MetricsDelta {
  current: number;
  previous: number;
  /** variação percentual com 1 casa; null quando `previous` é 0 */
  changePct: number | null;
}

export function metricsDelta(current: number, previous: number): MetricsDelta {
  const changePct =
    previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, changePct };
}

export interface MetricsGroupOption {
  jid: string;
  name: string;
}

export interface MetricsOverview {
  range: { from: string; to: string; previousFrom: string; previousTo: string };
  /** ISO do primeiro evento/snapshot de grupo do tenant; null se a coleta ainda não começou */
  trackingSince: string | null;
  /** todos os grupos monitorados (bot admin) do tenant, para o seletor de grupo */
  groupOptions: MetricsGroupOption[];
  kpis: {
    /** current = membros agora; previous = membros no início do período (agora − saldo do período) */
    members: MetricsDelta;
    joins: MetricsDelta;
    leaves: MetricsDelta;
    net: MetricsDelta;
    sends: MetricsDelta;
    /** percentual 0–100 */
    successRate: MetricsDelta;
    clicks: MetricsDelta;
  };
}

export interface MetricsGroupsDay {
  date: string;
  joins: number;
  leaves: number;
  net: number;
  /** saldo acumulado desde o início do período */
  cumulativeNet: number;
  /** soma dos snapshots do dia; null quando não há snapshot */
  members: number | null;
}

export interface MetricsGroupRow {
  jid: string;
  name: string;
  members: number;
  joins: number;
  leaves: number;
  net: number;
  /** saldo / membros no início do período × 100; null quando o início é 0 */
  growthPct: number | null;
}

export interface MetricsGroups {
  trackingSince: string | null;
  totals: { members: number; joins: number; leaves: number; net: number };
  series: MetricsGroupsDay[];
  /** ordenado por saldo desc, depois nome */
  groups: MetricsGroupRow[];
}

export interface MetricsSends {
  /** successRate em percentual 0–100 (0 quando total = 0) */
  totals: { total: number; sent: number; failed: number; successRate: number };
  daily: { date: string; sent: number; failed: number }[];
  /** 24 posições, hora local 0–23 */
  hourly: { hour: number; sent: number; failed: number }[];
  /** 168 células; weekday 0 = domingo … 6 = sábado */
  heatmap: { weekday: number; hour: number; count: number }[];
  /** até 5, mais frequentes primeiro */
  topErrors: { error: string; count: number }[];
}

export interface MetricsProducts {
  /** até 10, mais enviados primeiro */
  top: { productId: string; title: string; source: string; image: string | null; sends: number }[];
  byMarketplace: { source: string; sends: number }[];
}

export interface MetricsClicks {
  total: number;
  daily: { date: string; clicks: number }[];
  byLink: { groupLinkId: string; slug: string; label: string; clicks: number }[];
}

export interface MetricsAutomation {
  mirror: { captured: number; mirrored: number; discarded: number; errors: number };
  automation: { discovered: number; dispatched: number; skipped: number; errors: number };
  coupons: { validated: number; propagated: number };
  daily: { date: string; mirrored: number; dispatched: number }[];
}
