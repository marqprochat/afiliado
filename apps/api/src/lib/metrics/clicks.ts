import { Prisma, prisma } from '@afilados/db';
import type { MetricsClicks, MetricsQuery } from '@afilados/shared';
import { fillDays, inRange, localDay } from './common';

/** `groupJid` filtra pelo grupo de destino do redirecionamento. */
export async function getClicksMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsClicks> {
  const where = {
    tenantId,
    clickedAt: { gte: q.from, lt: q.to },
    ...(q.groupJid ? { targetGroupJid: q.groupJid } : {}),
  };
  const sqlWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"clickedAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "targetGroupJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const [total, dailyRows, perLink] = await Promise.all([
    prisma.linkClickEvent.count({ where }),
    prisma.$queryRaw<{ date: string; clicks: number }[]>`
      SELECT ${localDay('"clickedAt"')} AS date, COUNT(*)::int AS clicks
      FROM "LinkClickEvent" WHERE ${sqlWhere} GROUP BY 1`,
    prisma.linkClickEvent.groupBy({ by: ['groupLinkId'], where, _count: { _all: true } }),
  ]);
  const links = await prisma.groupLink.findMany({
    where: { tenantId, id: { in: perLink.map((r) => r.groupLinkId) } },
    select: { id: true, slug: true, label: true },
  });
  const byId = new Map(links.map((l) => [l.id, l]));
  const byLink = perLink
    .map((r) => ({
      groupLinkId: r.groupLinkId,
      slug: byId.get(r.groupLinkId)?.slug ?? '',
      label: byId.get(r.groupLinkId)?.label ?? '',
      clicks: r._count._all,
    }))
    .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label, 'pt-BR'));
  return {
    total,
    daily: fillDays(q.from, q.to, dailyRows, (date) => ({ date, clicks: 0 })),
    byLink,
  };
}
