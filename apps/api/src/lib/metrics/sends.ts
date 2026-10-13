import { Prisma, prisma } from '@afilados/db';
import type { MetricsQuery, MetricsSends } from '@afilados/shared';
import { fillDays, inRange, localDay, localTs, pct } from './common';

export async function getSendsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsSends> {
  const where = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"sentAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "groupJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const ts = localTs('"sentAt"');
  const [totalsRows, dailyRows, hourlyRows, heatRows, topErrors] = await Promise.all([
    prisma.$queryRaw<{ sent: number; failed: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where}`,
    prisma.$queryRaw<{ date: string; sent: number; failed: number }[]>`
      SELECT ${localDay('"sentAt"')} AS date,
             COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ hour: number; sent: number; failed: number }[]>`
      SELECT EXTRACT(HOUR FROM ${ts})::int AS hour,
             COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ weekday: number; hour: number; count: number }[]>`
      SELECT EXTRACT(DOW FROM ${ts})::int AS weekday,
             EXTRACT(HOUR FROM ${ts})::int AS hour,
             COUNT(*)::int AS count
      FROM "SendLog" WHERE ${where} GROUP BY 1, 2`,
    prisma.$queryRaw<{ error: string; count: number }[]>`
      SELECT LEFT(COALESCE(NULLIF(TRIM("error"), ''), 'Erro sem mensagem'), 200) AS error,
             COUNT(*)::int AS count
      FROM "SendLog" WHERE ${where} AND "status" = 'ERROR'
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 5`,
  ]);

  const sent = totalsRows[0]?.sent ?? 0;
  const failed = totalsRows[0]?.failed ?? 0;
  const byHour = new Map(hourlyRows.map((r) => [r.hour, r]));
  const heat = new Map(heatRows.map((r) => [r.weekday * 24 + r.hour, r.count]));
  const heatmap: MetricsSends['heatmap'] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({ weekday, hour, count: heat.get(weekday * 24 + hour) ?? 0 });
    }
  }
  return {
    totals: { total: sent + failed, sent, failed, successRate: pct(sent, sent + failed) },
    daily: fillDays(q.from, q.to, dailyRows, (date) => ({ date, sent: 0, failed: 0 })),
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sent: byHour.get(hour)?.sent ?? 0,
      failed: byHour.get(hour)?.failed ?? 0,
    })),
    heatmap,
    topErrors,
  };
}
