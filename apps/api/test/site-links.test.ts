import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let root: Awaited<ReturnType<typeof createTenantWithUser>>;
let rootCookie: string;
let affCookie: string;

const call = (method: 'GET' | 'PUT', cookie: string, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1/settings/site-links',
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

beforeAll(async () => {
  root = await createTenantWithUser('raiz-site-links');
  const aff = await createTenantWithUser('afiliado-site-links', root.tenantId);
  rootCookie = await loginCookie(app, root.email, root.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
});

afterAll(async () => {
  await cleanupTenant(root.tenantId);
  await app.close();
});

describe('settings/site-links', () => {
  it('sem configuração gravada, está desligado', async () => {
    const res = await call('GET', rootCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });

  it('PUT liga, grava em Setting e o GET reflete', async () => {
    const put = await call('PUT', rootCookie, { enabled: true });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ enabled: true });
    const row = await prisma.setting.findFirstOrThrow({
      where: { tenantId: root.tenantId, key: 'siteLinks' },
    });
    expect(row.value).toEqual({ enabled: true });
    expect((await call('GET', rootCookie)).json()).toEqual({ enabled: true });
  });

  it('PUT com corpo inválido → 400', async () => {
    const res = await call('PUT', rootCookie, { enabled: 'sim' });
    expect(res.statusCode).toBe(400);
  });

  it('afiliado não lê nem altera → 403', async () => {
    expect((await call('GET', affCookie)).statusCode).toBe(403);
    expect((await call('PUT', affCookie, { enabled: true })).statusCode).toBe(403);
  });
});
