import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '../src/index';

let a: string;
let b: string;
let sessionA: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'mirror-a' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'mirror-b' } })).id;
  sessionA = (await prisma.waSession.create({ data: { tenantId: a, label: 's' } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('MirrorRule/MirrorLog', () => {
  it('cria regra com defaults e log em cascata escopados por tenant', async () => {
    const rule = await prisma.mirrorRule.create({
      data: { tenantId: a, sessionId: sessionA, sourceJids: ['s@g.us'], targetJids: ['t@g.us'] },
    });
    expect(rule).toMatchObject({
      name: 'Espelhamento',
      mode: 'CLONE',
      mediaMode: 'PREVIEW',
      dedupHours: 12,
      enabled: true,
    });

    await prisma.mirrorLog.create({
      data: {
        tenantId: a,
        ruleId: rule.id,
        sourceJid: 's@g.us',
        sourceMsgId: 'm1',
        targetJid: 't@g.us',
        status: 'MIRRORED',
        productKey: 'SHOPEE:1',
      },
    });

    expect(await forTenant(a).mirrorLog.count()).toBe(1);
    expect(await forTenant(b).mirrorLog.count()).toBe(0);

    await prisma.mirrorRule.delete({ where: { id: rule.id } });
    expect(await prisma.mirrorLog.count({ where: { ruleId: rule.id } })).toBe(0);
  });
});
