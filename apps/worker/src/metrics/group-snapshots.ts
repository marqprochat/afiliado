import { prisma } from '@afilados/db';
import { spDayKey, spMidnight } from '@afilados/shared';

const DAY_MS = 86_400_000;

/** Fotografa `memberCount` de cada grupo com bot admin; um registro por sessão + grupo + dia de SP. */
export async function snapshotGroups(
  where: { sessionId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  const date = spMidnight(spDayKey(now));
  const groups = await prisma.waGroup.findMany({
    where: { botIsAdmin: true, ...(where.sessionId ? { sessionId: where.sessionId } : {}) },
    select: { tenantId: true, sessionId: true, jid: true, memberCount: true },
  });
  for (const g of groups) {
    await prisma.groupSnapshot.upsert({
      where: { sessionId_groupJid_date: { sessionId: g.sessionId, groupJid: g.jid, date } },
      update: { memberCount: g.memberCount },
      create: {
        tenantId: g.tenantId,
        sessionId: g.sessionId,
        groupJid: g.jid,
        date,
        memberCount: g.memberCount,
      },
    });
  }
  return groups.length;
}

export async function purgeOldMetrics(
  now: Date = new Date(),
  retentionDays = 365,
): Promise<{ events: number; snapshots: number; clicks: number }> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const [events, snapshots, clicks] = await prisma.$transaction([
    prisma.groupMemberEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.groupSnapshot.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.linkClickEvent.deleteMany({ where: { clickedAt: { lt: cutoff } } }),
  ]);
  return { events: events.count, snapshots: snapshots.count, clicks: clicks.count };
}
