import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AwinProgrammeStatsScheduler } from '../src/automation/awin-programme-stats-scheduler';

let ownerId: string;
let childId: string;
let noTokenId: string;

beforeAll(async () => {
  ownerId = (await prisma.tenant.create({ data: { name: 'prog-stats-sched-owner' } })).id;
  childId = (
    await prisma.tenant.create({
      data: { name: 'prog-stats-sched-child', parentTenantId: ownerId },
    })
  ).id;
  noTokenId = (await prisma.tenant.create({ data: { name: 'prog-stats-sched-no-token' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: ownerId,
      kind: 'AWIN',
      encryptedCredentials: encryptJson({
        feedListUrl: 'x',
        feedIds: [],
        publisherId: '1',
        offersApiToken: 't',
      }),
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: noTokenId,
      kind: 'AWIN',
      encryptedCredentials: encryptJson({ feedListUrl: 'x', feedIds: [] }),
    },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: childId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ownerId, noTokenId] } } });
  await prisma.$disconnect();
});

describe('AwinProgrammeStatsScheduler.tick', () => {
  it('1×/dia (UTC), só tenants donos com publisherId e token', async () => {
    let now = new Date('2026-11-26T03:00:00Z');
    const calls: string[] = [];
    const s = new AwinProgrammeStatsScheduler({
      enqueue: async (t) => void calls.push(t),
      now: () => now,
    });
    const mine = () => calls.filter((t) => [ownerId, childId, noTokenId].includes(t));

    await s.tick();
    expect(mine()).toEqual([ownerId]);

    calls.length = 0;
    now = new Date('2026-11-26T15:00:00Z');
    await s.tick();
    expect(mine()).toEqual([]);

    calls.length = 0;
    now = new Date('2026-11-27T00:10:00Z');
    await s.tick();
    expect(mine()).toEqual([ownerId]);
  });
});
