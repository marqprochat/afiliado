import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/index';

const tenantIds: string[] = [];
afterAll(async () => {
  // Robusto a testes que falham antes de registrar o id: limpa também por prefixo de nome
  // (afiliados primeiro, por causa do Restrict em parentTenantId).
  try {
    const byName = { name: { startsWith: 'aff-' } };
    await prisma.tenant.deleteMany({
      where: { OR: [{ id: { in: tenantIds } }, byName], parentTenantId: { not: null } },
    });
    await prisma.tenant.deleteMany({ where: { OR: [{ id: { in: tenantIds } }, byName] } });
  } finally {
    await prisma.$disconnect();
  }
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
    // P2003 = violação de chave estrangeira (onDelete: Restrict), não qualquer erro.
    await expect(prisma.tenant.delete({ where: { id: parent.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
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
