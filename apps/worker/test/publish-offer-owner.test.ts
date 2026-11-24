import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { isOwnerTenant, isSiteLinksEnabled } from '../src/lib/publish-offer';

let rootId: string;
let childId: string;
let rootUserId: string;

beforeAll(async () => {
  const root = await prisma.tenant.create({ data: { name: 'site-links-owner-root' } });
  rootId = root.id;
  rootUserId = (
    await prisma.user.create({
      data: { tenantId: rootId, email: `${rootId}@test.local`, name: 'Dono', passwordHash: 'x' },
    })
  ).id;
  const child = await prisma.tenant.create({
    data: { name: 'site-links-owner-child', parentTenantId: rootId },
  });
  childId = child.id;
  await prisma.user.create({
    data: {
      tenantId: childId,
      email: `${childId}@test.local`,
      name: 'Afiliado',
      passwordHash: 'x',
      isSuperAdmin: true,
    },
  });
  for (const tenantId of [rootId, childId]) {
    await prisma.setting.create({ data: { tenantId, key: 'siteLinks', value: { enabled: true } } });
  }
});

afterAll(async () => {
  const ids = [childId, rootId].filter((id): id is string => Boolean(id));
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('link do site: só o dono', () => {
  it('conta raiz sem superadmin, mesmo com a chave ligada → desligado', async () => {
    expect(await isOwnerTenant(rootId)).toBe(false);
    expect(await isSiteLinksEnabled(forTenant(rootId), rootId)).toBe(false);
  });

  it('conta filha (afiliado) com usuário superadmin → desligado', async () => {
    expect(await isOwnerTenant(childId)).toBe(false);
    expect(await isSiteLinksEnabled(forTenant(childId), childId)).toBe(false);
  });

  it('conta raiz com superadmin e a chave ligada → ligado', async () => {
    await prisma.user.update({ where: { id: rootUserId }, data: { isSuperAdmin: true } });
    expect(await isOwnerTenant(rootId)).toBe(true);
    expect(await isSiteLinksEnabled(forTenant(rootId), rootId)).toBe(true);
  });
});
