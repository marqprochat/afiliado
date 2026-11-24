import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let demotedSuperAdminIds: string[] = [];

const master = (tenantId: string, slug: string) =>
  prisma.masterProduct.create({
    data: {
      tenantId,
      title: slug,
      cleanTitle: slug,
      slug,
      lowestPriceEver: 10,
      averagePrice30d: 10,
      currentBestPrice: 10,
    },
  });

beforeAll(async () => {
  // O banco compartilhado de testes é semeado com um superadmin: rebaixa-o durante o teste e
  // restaura no afterAll (os testes deste pacote rodam em série).
  demotedSuperAdminIds = (
    await prisma.user.findMany({ where: { isSuperAdmin: true }, select: { id: true } })
  ).map((u) => u.id);
  if (demotedSuperAdminIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: demotedSuperAdminIds } },
      data: { isSuperAdmin: false },
    });
  }
  // O tenant sem superadmin é criado ANTES: o fallback antigo ("primeiro tenant com MasterProduct")
  // tenderia a escolhê-lo.
  other = await createTenantWithUser('Outro com vitrine');
  await master(other.tenantId, 'produto-do-outro-0001');
  owner = await createTenantWithUser('Dono');
  await prisma.user.update({ where: { id: owner.userId }, data: { isSuperAdmin: true } });
  await master(owner.tenantId, 'produto-do-dono-0001');
});

afterAll(async () => {
  if (demotedSuperAdminIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: demotedSuperAdminIds } },
      data: { isSuperAdmin: true },
    });
  }
  await cleanupTenant(other.tenantId);
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug anônimo', () => {
  it('serve as ofertas do tenant do superadmin', async () => {
    const dono = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-dono-0001' });
    expect(dono.statusCode).toBe(200);
    const outro = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-outro-0001' });
    expect(outro.statusCode).toBe(404);
  });
});
