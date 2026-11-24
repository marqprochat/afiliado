import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { isOwnerTenant, isSiteLinksEnabled } from '../src/lib/publish-offer';

// O dono é o superadmin mais antigo de uma conta raiz: o dono do teste nasce em 1971, antes de
// qualquer usuário do banco compartilhado; o segundo superadmin raiz é mais novo.
let ownerId: string;
let newerRootId: string;
let childId: string;
let plainRootId: string;

async function tenant(name: string, opts: { parent?: string; superAdmin?: boolean; year?: number }) {
  const t = await prisma.tenant.create({
    data: { name, ...(opts.parent ? { parentTenantId: opts.parent } : {}) },
  });
  await prisma.user.create({
    data: {
      tenantId: t.id,
      email: `${t.id}@test.local`,
      name,
      passwordHash: 'x',
      isSuperAdmin: opts.superAdmin ?? false,
      ...(opts.year ? { createdAt: new Date(`${opts.year}-01-01T00:00:00Z`) } : {}),
    },
  });
  await prisma.setting.create({
    data: { tenantId: t.id, key: 'siteLinks', value: { enabled: true } },
  });
  return t.id;
}

beforeAll(async () => {
  ownerId = await tenant('site-links-owner', { superAdmin: true, year: 1971 });
  newerRootId = await tenant('site-links-newer-root', { superAdmin: true, year: 2001 });
  childId = await tenant('site-links-owner-child', {
    parent: ownerId,
    superAdmin: true,
    year: 1970,
  });
  plainRootId = await tenant('site-links-owner-plain', { superAdmin: false, year: 1960 });
});

afterAll(async () => {
  const ids = [childId, ownerId, newerRootId, plainRootId].filter((id): id is string => Boolean(id));
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('link do site: só o dono (superadmin raiz mais antigo)', () => {
  it('o dono, com a chave ligada → ligado', async () => {
    expect(await isOwnerTenant(ownerId)).toBe(true);
    expect(await isSiteLinksEnabled(forTenant(ownerId), ownerId)).toBe(true);
  });

  it('segundo superadmin raiz (mais novo), mesmo com a chave ligada → desligado', async () => {
    expect(await isOwnerTenant(newerRootId)).toBe(false);
    expect(await isSiteLinksEnabled(forTenant(newerRootId), newerRootId)).toBe(false);
  });

  it('conta filha com superadmin, mesmo mais antigo → desligado', async () => {
    expect(await isOwnerTenant(childId)).toBe(false);
    expect(await isSiteLinksEnabled(forTenant(childId), childId)).toBe(false);
  });

  it('conta raiz sem superadmin → desligado', async () => {
    expect(await isOwnerTenant(plainRootId)).toBe(false);
    expect(await isSiteLinksEnabled(forTenant(plainRootId), plainRootId)).toBe(false);
  });
});
