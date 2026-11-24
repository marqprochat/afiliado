import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;

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
  // O tenant sem superadmin é criado ANTES: o fallback antigo ("primeiro tenant com MasterProduct")
  // tenderia a escolhê-lo.
  other = await createTenantWithUser('Outro com vitrine');
  await master(other.tenantId, 'produto-do-outro-0001');
  owner = await createTenantWithUser('Dono');
  await prisma.user.update({ where: { id: owner.userId }, data: { isSuperAdmin: true } });
  await master(owner.tenantId, 'produto-do-dono-0001');
});

afterAll(async () => {
  await cleanupTenant(other.tenantId);
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug anônimo', () => {
  it('serve as ofertas do tenant do superadmin', async () => {
    const others = await prisma.user.count({
      where: { isSuperAdmin: true, tenantId: { not: owner.tenantId } },
    });
    expect(others, 'há outro superadmin sobrando no banco de testes').toBe(0);

    const dono = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-dono-0001' });
    expect(dono.statusCode).toBe(200);
    const outro = await app.inject({ method: 'GET', url: '/api/v1/deals/produto-do-outro-0001' });
    expect(outro.statusCode).toBe(404);
  });
});
