import { hash } from '@node-rs/argon2';
import { prisma } from '@afilados/db';
import type { FastifyInstance } from 'fastify';

export async function createTenantWithUser(name = 'T', parentTenantId?: string) {
  const tenant = await prisma.tenant.create({
    data: { name, ...(parentTenantId ? { parentTenantId } : {}) },
  });
  const email = `${tenant.id}@test.local`;
  const password = 'senha-forte-123';
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, name: 'Test', passwordHash: await hash(password) },
  });
  await prisma.operatingWindow.create({ data: { tenantId: tenant.id } });
  await prisma.template.create({
    data: { tenantId: tenant.id, name: 'Padrão', body: '{titulo} {link}', isDefault: true },
  });
  return { tenantId: tenant.id, userId: user.id, email, password };
}

export async function cleanupTenant(tenantId: string) {
  const children = await prisma.tenant.findMany({
    where: { parentTenantId: tenantId },
    select: { id: true },
  });
  for (const c of children) await cleanupTenant(c.id);
  // BatchItem.productId é ON DELETE RESTRICT, então lotes (e seus itens, via
  // cascade de Batch) precisam ser removidos antes do Product cascatear do Tenant.
  await prisma.batch.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

export async function loginCookie(app: FastifyInstance, email: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 204) throw new Error(`login falhou: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return raw.split(';')[0]!;
}

/**
 * Torna o usuário o único superadmin (dono do site público: as rotas públicas de /deals servem o
 * tenant dele, ignorando a sessão). Devolve a função que restaura os superadmins anteriores; se a
 * promoção falhar no meio, restaura antes de propagar o erro.
 */
export async function makePublicSiteOwner(userId: string): Promise<() => Promise<void>> {
  const demoted = (
    await prisma.user.findMany({
      where: { isSuperAdmin: true, id: { not: userId } },
      select: { id: true },
    })
  ).map((u) => u.id);
  const restore = async () => {
    await prisma.user.updateMany({ where: { id: userId }, data: { isSuperAdmin: false } });
    if (demoted.length > 0) {
      await prisma.user.updateMany({ where: { id: { in: demoted } }, data: { isSuperAdmin: true } });
    }
  };
  try {
    if (demoted.length > 0) {
      await prisma.user.updateMany({ where: { id: { in: demoted } }, data: { isSuperAdmin: false } });
    }
    await prisma.user.update({ where: { id: userId }, data: { isSuperAdmin: true } });
  } catch (err) {
    await restore();
    throw err;
  }
  return restore;
}
