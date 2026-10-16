import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { AutomationScheduler } from '../src/automation/scheduler';

// Observa as consultas a Tenant sem trocar o comportamento. (Não usamos mockRestore: o delegate do
// Prisma não sobrevive a ele; o arquivo é isolado, então o espião vale só aqui.)
const realFindMany = prisma.tenant.findMany.bind(prisma.tenant);
const findMany = vi.spyOn(prisma.tenant, 'findMany') as unknown as {
  mockImplementation: (fn: (args: unknown) => unknown) => void;
  mock: { calls: unknown[][] };
  mockClear: () => void;
};
findMany.mockImplementation((args) => (realFindMany as (a: unknown) => unknown)(args));

let activeTenant: string;
let inactiveTenant: string;
let unrelatedInactive: string;
beforeAll(async () => {
  activeTenant = (await prisma.tenant.create({ data: { name: 'sch-active' } })).id;
  inactiveTenant = (await prisma.tenant.create({ data: { name: 'sch-off', active: false } })).id;
  unrelatedInactive = (
    await prisma.tenant.create({ data: { name: 'sch-off-unrelated', active: false } })
  ).id;
});
afterAll(async () => {
  await prisma.automationRule.deleteMany({
    where: { tenantId: { in: [activeTenant, inactiveTenant] } },
  });
  await prisma.tenant.deleteMany({
    where: { id: { in: [activeTenant, inactiveTenant, unrelatedInactive] } },
  });
  await prisma.$disconnect();
});

async function mkRule(tenantId: string) {
  const sess = await prisma.waSession.create({ data: { tenantId, label: 's' } });
  const tpl = await prisma.template.create({ data: { tenantId, name: 't', body: '{link}' } });
  return prisma.automationRule.create({
    data: {
      tenantId,
      name: 'r',
      enabled: true,
      marketplaces: ['SHOPEE'],
      keywords: ['x'],
      blockedKeywords: [],
      intervalMin: 5,
      sessionId: sess.id,
      groupJids: ['g@g.us'],
      templateId: tpl.id,
    },
  });
}

describe('AutomationScheduler.tick: consulta de tenants inativos', () => {
  it('consulta só os tenants das regras carregadas', async () => {
    await mkRule(activeTenant);
    await mkRule(inactiveTenant);
    const scheduler = new AutomationScheduler({ discover: async () => {} });
    await scheduler.reload();
    findMany.mockClear();
    await scheduler.tick();
    const inactiveQueries = findMany.mock.calls.filter(
      (c) => (c[0] as { where?: { active?: boolean } } | undefined)?.where?.active === false,
    );
    expect(inactiveQueries).toHaveLength(1);
    const where = (inactiveQueries[0]![0] as { where: { id: { in: string[] } } }).where;
    expect(where.id.in).toEqual(expect.arrayContaining([activeTenant, inactiveTenant]));
    expect(where.id.in).not.toContain(unrelatedInactive);
  });

  it('sem regras carregadas, nem consulta', async () => {
    await prisma.automationRule.deleteMany({
      where: { tenantId: { in: [activeTenant, inactiveTenant] } },
    });
    const scheduler = new AutomationScheduler({ discover: async () => {} });
    await scheduler.reload();
    // outras regras de dev/teste no banco podem existir; zere o que foi carregado
    (scheduler as unknown as { rules: unknown[] }).rules = [];
    findMany.mockClear();
    await scheduler.tick();
    expect(findMany.mock.calls).toHaveLength(0);
  });
});
