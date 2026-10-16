import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('login e /me de afiliado', () => {
  it('/me marca isAffiliate e isSuperAdmin', async () => {
    const cookie = await loginCookie(app, aff.email, aff.password);
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json();
    expect(me).toMatchObject({
      isAffiliate: true,
      impersonating: null,
      user: { isSuperAdmin: false },
    });
  });
  it('tenant inativo: login 403 ACCOUNT_DISABLED e sessão antiga deixa de valer', async () => {
    const cookie = await loginCookie(app, aff.email, aff.password);
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: false } });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: aff.email, password: aff.password },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('ACCOUNT_DISABLED');
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: true } });
  });
});
