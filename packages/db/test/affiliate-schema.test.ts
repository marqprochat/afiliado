import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/index';

const tenantIds: string[] = [];
afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: tenantIds }, parentTenantId: { not: null } },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('schema de afiliados', () => {
  it('tenant nasce ativo e sem pai; afiliado aponta para o pai', async () => {
    const parent = await prisma.tenant.create({ data: { name: 'aff-parent' } });
    const child = await prisma.tenant.create({
      data: { name: 'aff-child', parentTenantId: parent.id },
    });
    tenantIds.push(parent.id, child.id);
    expect(parent.active).toBe(true);
    expect(parent.parentTenantId).toBeNull();
    expect(child.parentTenantId).toBe(parent.id);
  });

  it('não exclui o tenant pai enquanto houver afiliado', async () => {
    const parent = await prisma.tenant.create({ data: { name: 'aff-parent2' } });
    const child = await prisma.tenant.create({
      data: { name: 'aff-child2', parentTenantId: parent.id },
    });
    tenantIds.push(parent.id, child.id);
    await expect(prisma.tenant.delete({ where: { id: parent.id } })).rejects.toThrow();
  });

  it('User.isSuperAdmin nasce false; subId é opcional; Session guarda impersonatorUserId', async () => {
    const t = await prisma.tenant.create({ data: { name: 'aff-user' } });
    tenantIds.push(t.id);
    const u = await prisma.user.create({
      data: { tenantId: t.id, email: `${t.id}@t.local`, name: 'U', passwordHash: 'x' },
    });
    expect(u.isSuperAdmin).toBe(false);
    const c = await prisma.marketplaceConnection.create({
      data: { tenantId: t.id, kind: 'SHOPEE', subId: 'joao' },
    });
    expect(c.subId).toBe('joao');
    const s = await prisma.session.create({
      data: {
        id: `s-${t.id}`,
        userId: u.id,
        expiresAt: new Date(Date.now() + 1000),
        impersonatorUserId: u.id,
      },
    });
    expect(s.impersonatorUserId).toBe(u.id);
  });
});
