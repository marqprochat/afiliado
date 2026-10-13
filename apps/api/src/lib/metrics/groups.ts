import { Prisma, prisma } from '@afilados/db';
import type { MetricsGroupRow, MetricsGroups, MetricsQuery } from '@afilados/shared';
import { adminGroupsOf, fillDays, inRange, localDay } from './common';

export async function getTrackingSince(tenantId: string): Promise<string | null> {
  const [ev, snap] = await Promise.all([
    prisma.groupMemberEvent.aggregate({ where: { tenantId }, _min: { occurredAt: true } }),
    prisma.groupSnapshot.aggregate({ where: { tenantId }, _min: { createdAt: true } }),
  ]);
  const dates = [ev._min.occurredAt, snap._min.createdAt].filter(
    (d): d is Date => d instanceof Date,
  );
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
}

export async function getGroupsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsGroups> {
  const byGroup = q.groupJid ? Prisma.sql` AND "groupJid" = ${q.groupJid}` : Prisma.empty;
  const evWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"occurredAt"', q.from, q.to)}${byGroup}`;
  const counts = Prisma.sql`
    COUNT(*) FILTER (WHERE "action" IN ('JOIN', 'ADDED'))::int AS joins,
    COUNT(*) FILTER (WHERE "action" IN ('LEAVE', 'REMOVED'))::int AS leaves`;

  const [groups, perGroup, perDay, snapDays, trackingSince] = await Promise.all([
    adminGroupsOf(tenantId, q.groupJid),
    prisma.$queryRaw<{ groupJid: string; joins: number; leaves: number }[]>`
      SELECT "groupJid", ${counts} FROM "GroupMemberEvent" WHERE ${evWhere} GROUP BY 1`,
    prisma.$queryRaw<{ date: string; joins: number; leaves: number }[]>`
      SELECT ${localDay('"occurredAt"')} AS date, ${counts}
      FROM "GroupMemberEvent" WHERE ${evWhere} GROUP BY 1`,
    prisma.$queryRaw<{ date: string; members: number }[]>`
      SELECT ${localDay('"date"')} AS date, SUM("memberCount")::int AS members
      FROM "GroupSnapshot"
      WHERE "tenantId" = ${tenantId} AND ${inRange('"date"', q.from, q.to)}${byGroup}
      GROUP BY 1`,
    getTrackingSince(tenantId),
  ]);

  const moves = new Map(perGroup.map((r) => [r.groupJid, r]));
  const rows: MetricsGroupRow[] = groups
    .map((g) => {
      const joins = moves.get(g.jid)?.joins ?? 0;
      const leaves = moves.get(g.jid)?.leaves ?? 0;
      const net = joins - leaves;
      const start = g.memberCount - net;
      return {
        jid: g.jid,
        name: g.name,
        members: g.memberCount,
        joins,
        leaves,
        net,
        growthPct: start > 0 ? Math.round((net / start) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'pt-BR'));

  const membersByDay = new Map(snapDays.map((r) => [r.date, r.members]));
  let cumulative = 0;
  const series = fillDays(q.from, q.to, perDay, (date) => ({ date, joins: 0, leaves: 0 })).map(
    (d) => {
      const net = d.joins - d.leaves;
      cumulative += net;
      return {
        date: d.date,
        joins: d.joins,
        leaves: d.leaves,
        net,
        cumulativeNet: cumulative,
        members: membersByDay.get(d.date) ?? null,
      };
    },
  );

  const joins = perGroup.reduce((s, r) => s + r.joins, 0);
  const leaves = perGroup.reduce((s, r) => s + r.leaves, 0);
  return {
    trackingSince,
    totals: {
      members: rows.reduce((s, r) => s + r.members, 0),
      joins,
      leaves,
      net: joins - leaves,
    },
    series,
    groups: rows,
  };
}
