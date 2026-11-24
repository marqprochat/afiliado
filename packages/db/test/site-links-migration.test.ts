import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/index';

const sql = readFileSync(
  fileURLToPath(
    new URL('../prisma/migrations/20261123120000_site_links_owner/migration.sql', import.meta.url),
  ),
  'utf8',
);

let owner: string;
let child: string;
let plain: string;

async function tenantWithUser(name: string, isSuperAdmin: boolean, parentTenantId?: string) {
  const t = await prisma.tenant.create({
    data: { name, ...(parentTenantId ? { parentTenantId } : {}) },
  });
  await prisma.user.create({
    data: { tenantId: t.id, email: `${t.id}@mig.test`, name, passwordHash: 'x', isSuperAdmin },
  });
  return t.id;
}

beforeAll(async () => {
  owner = await tenantWithUser('dono-mig', true);
  child = await tenantWithUser('afiliado-mig', false, owner);
  plain = await tenantWithUser('comum-mig', false);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [child, plain] } } });
  await prisma.tenant.deleteMany({ where: { id: owner } });
  await prisma.$disconnect();
});

describe('migração 20261123120000_site_links_owner', () => {
  it('liga siteLinks só para o tenant do superadmin e é idempotente', async () => {
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    const rows = await prisma.setting.findMany({
      where: { key: 'siteLinks', tenantId: { in: [owner, child, plain] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: owner, value: { enabled: true } });
  });

  it('não sobrescreve um valor já gravado', async () => {
    await prisma.setting.update({
      where: { tenantId_key: { tenantId: owner, key: 'siteLinks' } },
      data: { value: { enabled: false } },
    });
    await prisma.$executeRawUnsafe(sql);
    const row = await prisma.setting.findFirstOrThrow({
      where: { tenantId: owner, key: 'siteLinks' },
    });
    expect(row.value).toEqual({ enabled: false });
  });
});
