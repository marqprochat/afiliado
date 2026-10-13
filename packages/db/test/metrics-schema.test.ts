import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, Prisma } from '../src/index';

let a: string;
let b: string;
let sessionA: string;
let linkId: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'metrics-a' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'metrics-b' } })).id;
  sessionA = (await prisma.waSession.create({ data: { tenantId: a, label: 's' } })).id;
  linkId = (
    await prisma.groupLink.create({
      data: {
        tenantId: a,
        sessionId: sessionA,
        slug: `metrics-${Date.now()}`,
        label: 'L',
        baseName: 'Grupo',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('modelos de métricas', () => {
  it('GroupMemberEvent é idempotente por dedupeKey e escopado por tenant', async () => {
    const data = {
      tenantId: a,
      sessionId: sessionA,
      groupJid: 'g1@g.us',
      participantJid: '5511999990000@s.whatsapp.net',
      action: 'JOIN' as const,
      occurredAt: new Date('2026-10-13T12:00:00Z'),
      dedupeKey: `k-${Date.now()}`,
    };
    await prisma.groupMemberEvent.create({ data });
    await expect(prisma.groupMemberEvent.create({ data })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    const skipped = await prisma.groupMemberEvent.createMany({
      data: [data],
      skipDuplicates: true,
    });
    expect(skipped.count).toBe(0);
    expect(await forTenant(a).groupMemberEvent.count()).toBe(1);
    expect(await forTenant(b).groupMemberEvent.count()).toBe(0);
  });

  it('GroupSnapshot é único por sessão + grupo + dia', async () => {
    const date = new Date('2026-10-13T03:00:00Z');
    await prisma.groupSnapshot.create({
      data: { tenantId: a, sessionId: sessionA, groupJid: 'g1@g.us', date, memberCount: 10 },
    });
    const up = await prisma.groupSnapshot.upsert({
      where: { sessionId_groupJid_date: { sessionId: sessionA, groupJid: 'g1@g.us', date } },
      update: { memberCount: 12 },
      create: { tenantId: a, sessionId: sessionA, groupJid: 'g1@g.us', date, memberCount: 12 },
    });
    expect(up.memberCount).toBe(12);
    expect(await prisma.groupSnapshot.count({ where: { tenantId: a } })).toBe(1);
  });

  it('LinkClickEvent cai em cascata com o GroupLink', async () => {
    await prisma.linkClickEvent.create({
      data: { tenantId: a, groupLinkId: linkId, slug: 'x', targetGroupJid: 'g1@g.us' },
    });
    expect(await forTenant(a).linkClickEvent.count()).toBe(1);
    await prisma.groupLink.delete({ where: { id: linkId } });
    expect(await prisma.linkClickEvent.count({ where: { tenantId: a } })).toBe(0);
  });
});
