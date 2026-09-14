import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  t = await createTenantWithUser();
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('auth', () => {
  it('login inválido → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: t.email, password: 'errada' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });
  it('body inválido → 400 VALIDATION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
  it('login ok → cookie httpOnly; /me devolve usuário e tenant', async () => {
    const cookie = await loginCookie(app, t.email, t.password);
    expect(cookie.startsWith('afilados_session=')).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: t.email, role: 'OWNER' },
      tenant: { id: t.tenantId },
    });
    expect(me.json().user.passwordHash).toBeUndefined();
  });
  it('/me sem cookie → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });
  it('logout invalida a sessão', async () => {
    const cookie = await loginCookie(app, t.email, t.password);
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
