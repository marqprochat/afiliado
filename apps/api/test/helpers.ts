import { hash } from '@node-rs/argon2';
import { prisma } from '@afilados/db';
import type { FastifyInstance } from 'fastify';

export async function createTenantWithUser(name = 'T') {
  const tenant = await prisma.tenant.create({ data: { name } });
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
