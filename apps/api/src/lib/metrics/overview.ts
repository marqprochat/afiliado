import { prisma } from '@afilados/db';
import {
  metricsDelta,
  previousRange,
  type MetricsOverview,
  type MetricsQuery,
} from '@afilados/shared';
import { adminGroupsOf, pct } from './common';
import { getTrackingSince } from './groups';

async function kpiValues(tenantId: string, q: MetricsQuery) {
  const range = { gte: q.from, lt: q.to };
  const byGroup = q.groupJid ? { groupJid: q.groupJid } : {};
  const [joins, leaves, sends, clicks] = await Promise.all([
    prisma.groupMemberEvent.count({
      where: { tenantId, occurredAt: range, action: { in: ['JOIN', 'ADDED'] }, ...byGroup },
    }),
    prisma.groupMemberEvent.count({
      where: { tenantId, occurredAt: range, action: { in: ['LEAVE', 'REMOVED'] }, ...byGroup },
    }),
    prisma.sendLog.groupBy({
      by: ['status'],
      where: { tenantId, sentAt: range, ...byGroup },
      _count: { _all: true },
    }),
    prisma.linkClickEvent.count({
      where: {
        tenantId,
        clickedAt: range,
        ...(q.groupJid ? { targetGroupJid: q.groupJid } : {}),
      },
    }),
  ]);
  const sent = sends.find((s) => s.status === 'SENT')?._count._all ?? 0;
  const failed = sends.find((s) => s.status === 'ERROR')?._count._all ?? 0;
  return {
    joins,
    leaves,
    net: joins - leaves,
    sends: sent + failed,
    successRate: pct(sent, sent + failed),
    clicks,
  };
}

export async function getOverviewMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsOverview> {
  const prev = previousRange(q.from, q.to);
  const prevQuery: MetricsQuery = { ...q, from: prev.from, to: prev.to };
  const [cur, before, groups, allGroups, trackingSince] = await Promise.all([
    kpiValues(tenantId, q),
    kpiValues(tenantId, prevQuery),
    adminGroupsOf(tenantId, q.groupJid),
    adminGroupsOf(tenantId),
    getTrackingSince(tenantId),
  ]);
  const membersNow = groups.reduce((s, g) => s + g.memberCount, 0);
  return {
    range: {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      previousFrom: prev.from.toISOString(),
      previousTo: prev.to.toISOString(),
    },
    trackingSince,
    groupOptions: allGroups.map(({ jid, name }) => ({ jid, name })),
    kpis: {
      members: metricsDelta(membersNow, membersNow - cur.net),
      joins: metricsDelta(cur.joins, before.joins),
      leaves: metricsDelta(cur.leaves, before.leaves),
      net: metricsDelta(cur.net, before.net),
      sends: metricsDelta(cur.sends, before.sends),
      successRate: metricsDelta(cur.successRate, before.successRate),
      clicks: metricsDelta(cur.clicks, before.clicks),
    },
  };
}
