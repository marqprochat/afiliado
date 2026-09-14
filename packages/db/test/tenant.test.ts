import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '../src/index';

let a: string;
let b: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'A' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'B' } })).id;
  await prisma.template.create({ data: { tenantId: a, name: 'ta', body: 'x' } });
  await prisma.template.create({ data: { tenantId: b, name: 'tb', body: 'y' } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('forTenant', () => {
  it('findMany só vê o próprio tenant', async () => {
    const rows = await forTenant(a).template.findMany();
    expect(rows.map((r) => r.name)).toEqual(['ta']);
  });
  it('create injeta tenantId', async () => {
    // @ts-expect-error tenantId é injetado em runtime pela extensão forTenant; o tipo do Prisma não reflete isso
    const t = await forTenant(b).template.create({ data: { name: 'tb2', body: 'z' } });
    expect(t.tenantId).toBe(b);
  });
  it('updateMany em registro de outro tenant não afeta nada', async () => {
    const other = await prisma.template.findFirstOrThrow({ where: { tenantId: a } });
    const res = await forTenant(b).template.updateMany({ where: { id: other.id }, data: { name: 'hack' } });
    expect(res.count).toBe(0);
  });
  it('operatingWindow é escopado por tenant', async () => {
    await prisma.operatingWindow.upsert({ where: { tenantId: a }, update: {}, create: { tenantId: a } });
    await prisma.operatingWindow.upsert({ where: { tenantId: b }, update: {}, create: { tenantId: b } });
    const rows = await forTenant(a).operatingWindow.findMany();
    expect(rows.map((r) => r.tenantId)).toEqual([a]);
  });
});
