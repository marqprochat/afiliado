import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { CouponSyncScheduler } from '../src/automation/coupon-sync-scheduler';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'coupon-scheduler-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'ALIEXPRESS',
      status: 'OK',
      encryptedCredentials: encryptJson({ appKey: 'k', appSecret: 's', trackingId: 't' }),
    },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('CouponSyncScheduler.tick', () => {
  it('enfileira a sincronização de todos os tenants com ALIEXPRESS ou AWIN configurados', async () => {
    const enqueued: string[] = [];
    const scheduler = new CouponSyncScheduler({ enqueue: async (t) => void enqueued.push(t) });
    await scheduler.tick();
    expect(enqueued).toContain(tenantId);
  });
});

describe('CouponSyncScheduler.start', () => {
  it('dispara um tick imediato ao iniciar', async () => {
    const enqueued: string[] = [];
    let resolveEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveEnqueue = resolve;
    });
    const scheduler = new CouponSyncScheduler({
      enqueue: async (t) => {
        enqueued.push(t);
        if (t === tenantId) {
          resolveEnqueue();
        }
      },
    });
    scheduler.start();
    try {
      await gate;
      expect(enqueued).toContain(tenantId);
    } finally {
      scheduler.stop();
    }
  });
});
