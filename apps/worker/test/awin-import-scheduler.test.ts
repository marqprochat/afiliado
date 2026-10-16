import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AwinImportScheduler } from '../src/automation/awin-import-scheduler';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-scheduler-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({
        feedListUrl: 'https://ui.awin.com/feedList/secret',
        feedIds: ['f1'],
      }),
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('AwinImportScheduler.tick', () => {
  it('enfileira o import de todos os tenants com AWIN configurada', async () => {
    const enqueued: string[] = [];
    const scheduler = new AwinImportScheduler({ enqueue: async (t) => void enqueued.push(t) });
    await scheduler.tick();
    expect(enqueued).toContain(tenantId);
  });
});

describe('AwinImportScheduler.tick (afiliados)', () => {
  it('inclui afiliados ativos do dono e ignora inativos', async () => {
    const owner = await prisma.tenant.create({ data: { name: 'as-owner' } });
    const on = await prisma.tenant.create({ data: { name: 'as-on', parentTenantId: owner.id } });
    const off = await prisma.tenant.create({
      data: { name: 'as-off', parentTenantId: owner.id, active: false },
    });
    try {
      await prisma.marketplaceConnection.create({
        data: {
          tenantId: owner.id,
          kind: 'AWIN',
          encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x' }),
        },
      });
      const enqueued: string[] = [];
      const scheduler = new AwinImportScheduler({ enqueue: async (t) => void enqueued.push(t) });
      await scheduler.tick();
      expect(enqueued).toEqual(expect.arrayContaining([owner.id, on.id]));
      expect(enqueued).not.toContain(off.id);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: { in: [on.id, off.id] } } });
      await prisma.tenant.deleteMany({ where: { id: owner.id } });
    }
  });
});

describe('AwinImportScheduler.start', () => {
  it('dispara um tick imediato ao iniciar, sem esperar o intervalo', async () => {
    const enqueued: string[] = [];
    let resolveEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveEnqueue = resolve;
    });
    const scheduler = new AwinImportScheduler({
      enqueue: async (t) => {
        enqueued.push(t);
        resolveEnqueue();
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
