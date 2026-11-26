import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AwinSalesSyncScheduler } from '../src/automation/awin-sales-sync-scheduler';

let ownerId: string;
let childId: string;

beforeAll(async () => {
  ownerId = (await prisma.tenant.create({ data: { name: 'sales-sched-owner' } })).id;
  childId = (
    await prisma.tenant.create({ data: { name: 'sales-sched-child', parentTenantId: ownerId } })
  ).id;
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
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: childId } });
  await prisma.tenant.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('AwinSalesSyncScheduler.tick', () => {
  it('a cada hora: janela de 7 dias; 1×/dia: 31 dias; só tenants donos da credencial', async () => {
    let now = new Date('2026-11-25T10:00:00Z');
    const calls: [string, number][] = [];
    const s = new AwinSalesSyncScheduler({
      enqueue: async (t, days) => void calls.push([t, days]),
      now: () => now,
    });

    await s.tick();
    const mine = () => calls.filter(([t]) => t === ownerId || t === childId);
    expect(mine()).toEqual([
      [ownerId, 7],
      [ownerId, 31],
    ]);

    calls.length = 0;
    now = new Date('2026-11-25T11:00:00Z');
    await s.tick();
    expect(mine()).toEqual([[ownerId, 7]]);

    calls.length = 0;
    now = new Date('2026-11-26T00:30:00Z');
    await s.tick();
    expect(mine()).toEqual([
      [ownerId, 7],
      [ownerId, 31],
    ]);
  });
});
