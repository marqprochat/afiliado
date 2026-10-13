import { Prisma, prisma, type AutomationLogAction, type MirrorLogStatus } from '@afilados/db';
import { spDayKeysInRange, type MetricsAutomation, type MetricsQuery } from '@afilados/shared';
import { inRange, localDay } from './common';

/** `groupJid` filtra o destino do espelhamento e os envios de cupom; o AutomationLog não tem grupo. */
export async function getAutomationMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsAutomation> {
  const range = { gte: q.from, lt: q.to };
  const mirrorWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"createdAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "targetJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const autoWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"createdAt"', q.from, q.to)}`;

  const [mirrorRows, capturedRows, autoRows, validated, propagated, mirrorDaily, dispatchDaily] =
    await Promise.all([
      prisma.mirrorLog.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: range, ...(q.groupJid ? { targetJid: q.groupJid } : {}) },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ captured: number }[]>`
        SELECT COUNT(DISTINCT "sourceJid" || ':' || "sourceMsgId")::int AS captured
        FROM "MirrorLog" WHERE ${mirrorWhere}`,
      prisma.automationLog.groupBy({
        by: ['action'],
        where: { tenantId, createdAt: range },
        _count: { _all: true },
      }),
      prisma.couponCheck.count({ where: { tenantId, result: 'VALID', createdAt: range } }),
      prisma.sendLog.count({
        where: {
          tenantId,
          status: 'SENT',
          sentAt: range,
          batchItem: { couponId: { not: null } },
          ...(q.groupJid ? { groupJid: q.groupJid } : {}),
        },
      }),
      prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT ${localDay('"createdAt"')} AS date, COUNT(*)::int AS count
        FROM "MirrorLog" WHERE ${mirrorWhere} AND "status" = 'MIRRORED' GROUP BY 1`,
      prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT ${localDay('"createdAt"')} AS date, COUNT(*)::int AS count
        FROM "AutomationLog" WHERE ${autoWhere} AND "action" = 'DISPATCHED' GROUP BY 1`,
    ]);

  const mirrorCount = (s: MirrorLogStatus) =>
    mirrorRows.find((r) => r.status === s)?._count._all ?? 0;
  const autoCount = (a: AutomationLogAction) =>
    autoRows.find((r) => r.action === a)?._count._all ?? 0;
  const mirroredByDay = new Map(mirrorDaily.map((r) => [r.date, r.count]));
  const dispatchedByDay = new Map(dispatchDaily.map((r) => [r.date, r.count]));

  return {
    mirror: {
      captured: capturedRows[0]?.captured ?? 0,
      mirrored: mirrorCount('MIRRORED'),
      discarded: mirrorCount('DISCARDED'),
      errors: mirrorCount('ERROR'),
    },
    automation: {
      discovered: autoCount('DISCOVERED'),
      dispatched: autoCount('DISPATCHED'),
      skipped: autoCount('SKIPPED'),
      errors: autoCount('ERROR'),
    },
    coupons: { validated, propagated },
    daily: spDayKeysInRange(q.from, q.to).map((date) => ({
      date,
      mirrored: mirroredByDay.get(date) ?? 0,
      dispatched: dispatchedByDay.get(date) ?? 0,
    })),
  };
}
