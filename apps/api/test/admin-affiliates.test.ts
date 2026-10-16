// apps/api/test/admin-affiliates.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let admin: Awaited<ReturnType<typeof createTenantWithUser>>;
let adminCookie: string;
let plain: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  admin = await createTenantWithUser('admin');
  await prisma.user.update({ where: { id: admin.userId }, data: { isSuperAdmin: true } });
  plain = await createTenantWithUser('comum');
  adminCookie = await loginCookie(app, admin.email, admin.password);
});
afterAll(async () => {
  await cleanupTenant(admin.tenantId);
  await cleanupTenant(plain.tenantId);
  await app.close();
});

const cookiesOf = (r: { headers: Record<string, unknown> }) => {
  const sc = r.headers["set-cookie"];
  return (Array.isArray(sc) ? sc : sc ? [String(sc)] : []) as string[];
};
const email = () => `aff-${Math.random().toString(36).slice(2)}@test.local`;
const post = (url: string, payload: unknown, cookie = adminCookie) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload: payload as object });

describe('admin/affiliates', () => {
  it('sem login 401; usuário comum 403', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates' })).statusCode).toBe(401);
    const cookie = await loginCookie(app, plain.email, plain.password);
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('cria afiliado com senha gerada, estrutura padrão e SubIDs; e-mail repetido → 409', async () => {
    const e = email();
    const r = await post('/admin/affiliates', { name: 'João', email: e, subIds: { SHOPEE: 'joao', AMAZON: 'joao-20' } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.initialPassword).toBeTruthy();
    expect(body.subIds).toEqual({ SHOPEE: 'joao', AMAZON: 'joao-20' });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: body.id } });
    expect(t.parentTenantId).toBe(admin.tenantId);
    expect(await prisma.template.count({ where: { tenantId: body.id, isDefault: true } })).toBe(1);
    expect(await prisma.operatingWindow.count({ where: { tenantId: body.id } })).toBe(1);
    await loginCookie(app, e, body.initialPassword);
    expect((await post('/admin/affiliates', { name: 'Outro', email: e })).statusCode).toBe(409);
  });

  it('lista, edita nome/SubIDs (vazio remove) e não enxerga afiliado de outro admin', async () => {
    const created = (await post('/admin/affiliates', { name: 'Maria', email: email(), password: 'senha-forte-1' })).json();
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie: adminCookie } })).json();
    expect(list.find((a: { id: string }) => a.id === created.id)).toMatchObject({ name: 'Maria', active: true, sends7d: 0 });
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${created.id}`, headers: { cookie: adminCookie },
      payload: { name: 'Maria S', subIds: { SHOPEE: 'maria' } },
    });
    expect(patch.json()).toMatchObject({ name: 'Maria S', subIds: { SHOPEE: 'maria' } });
    const clear = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${created.id}`, headers: { cookie: adminCookie },
      payload: { subIds: { SHOPEE: '' } },
    });
    expect(clear.json().subIds).toEqual({});
    const foreign = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${plain.tenantId}`, headers: { cookie: adminCookie },
      payload: { name: 'x' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('desativar derruba sessões e bloqueia login; reativar libera', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Pedro', email: e, password: 'senha-forte-1' })).json();
    const cookie = await loginCookie(app, e, 'senha-forte-1');
    expect((await post(`/admin/affiliates/${c.id}/active`, { active: false })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: e, password: 'senha-forte-1' } });
    expect(login.json().error.code).toBe('ACCOUNT_DISABLED');
    expect((await post(`/admin/affiliates/${c.id}/active`, { active: true })).statusCode).toBe(204);
    await loginCookie(app, e, 'senha-forte-1');
  });

  it('redefine a senha', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Ana', email: e, password: 'senha-forte-1' })).json();
    const r = await post(`/admin/affiliates/${c.id}/reset-password`, {});
    const { password } = r.json();
    await loginCookie(app, e, password);
    const old = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: e, password: 'senha-forte-1' } });
    expect(old.statusCode).toBe(401);
  });

  it('entrar como: /me mostra impersonating, /admin fica bloqueado, voltar restaura o admin', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Lia', email: e, password: 'senha-forte-1' })).json();
    const imp = await post(`/admin/affiliates/${c.id}/impersonate`, {});
    expect(imp.statusCode).toBe(204);
    const cookies = cookiesOf(imp).map((s) => s.split(';')[0]!);
    const header = cookies.join('; ');
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: header } })).json();
    expect(me).toMatchObject({ tenant: { id: c.id }, impersonating: { by: expect.any(String) }, isAffiliate: true });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie: header } })).statusCode).toBe(403);
    const stop = await app.inject({ method: 'POST', url: '/api/v1/admin/impersonation/stop', headers: { cookie: header } });
    expect(stop.statusCode).toBe(204);
    const restored = cookiesOf(stop).find((s) => s.startsWith('afilados_session=') && !s.startsWith('afilados_session=;'))!;
    const back = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: restored.split(';')[0]! } })).json();
    expect(back).toMatchObject({ tenant: { id: admin.tenantId }, impersonating: null });
  });

  it('isolamento: afiliado só vê os próprios templates', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Iso', email: e, password: 'senha-forte-1' })).json();
    const cookie = await loginCookie(app, e, 'senha-forte-1');
    const r = (await app.inject({ method: 'GET', url: '/api/v1/templates', headers: { cookie } })).json();
    expect(JSON.stringify(r)).not.toContain(admin.tenantId);
    expect(c.id).not.toBe(admin.tenantId);
  });
});
