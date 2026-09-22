import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { AwinImportScheduler } from '../src/automation/awin-import-scheduler';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-scheduler-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: { tenantId, kind: 'AWIN', status: 'OK', encryptedCredentials: encryptJson({ publisherId: 'p', datafeedApiKey: 'k', feedIds: ['f1'] }) },
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
