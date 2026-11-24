import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let root: Awaited<ReturnType<typeof createTenantWithUser>>;
let rootCookie: string;
let affCookie: string;
let plain: Awaited<ReturnType<typeof createTenantWithUser>> | undefined;
let plainCookie: string;
let newer: Awaited<ReturnType<typeof createTenantWithUser>> | undefined;
let newerCookie: string;

const call = (method: 'GET' | 'PUT', cookie: string, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1/settings/site-links',
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

beforeAll(async () => {
  root = await createTenantWithUser('raiz-site-links');
  // Só o dono (superadmin raiz mais antigo) liga o link do site: este nasce em 1972, antes de
  // qualquer usuário do banco compartilhado.
  await prisma.user.update({
    where: { id: root.userId },
    data: { isSuperAdmin: true, createdAt: new Date('1972-01-01T00:00:00Z') },
  });
  // Segundo superadmin de conta raiz, mais novo: não é o dono.
  newer = await createTenantWithUser('raiz-nova-site-links');
  await prisma.user.update({
    where: { id: newer.userId },
    data: { isSuperAdmin: true, createdAt: new Date('2002-01-01T00:00:00Z') },
  });
  newerCookie = await loginCookie(app, newer.email, newer.password);
  const aff = await createTenantWithUser('afiliado-site-links', root.tenantId);
  plain = await createTenantWithUser('outra-conta-site-links');
  plainCookie = await loginCookie(app, plain.email, plain.password);
  rootCookie = await loginCookie(app, root.email, root.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
});

afterAll(async () => {
  try {
    if (root) await cleanupTenant(root.tenantId);
    if (plain) await cleanupTenant(plain.tenantId);
    if (newer) await cleanupTenant(newer.tenantId);
  } finally {
    await app.close();
  }
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

  it('dono de outra conta (não superadmin) não lê nem altera → 403', async () => {
    expect((await call('GET', plainCookie)).statusCode).toBe(403);
    expect((await call('PUT', plainCookie, { enabled: true })).statusCode).toBe(403);
    const row = await prisma.setting.findFirst({
      where: { tenantId: plain!.tenantId, key: 'siteLinks' },
    });
    expect(row).toBeNull();
  });

  it('segundo superadmin de conta raiz (não é o dono) não lê nem altera → 403', async () => {
    expect((await call('GET', newerCookie)).statusCode).toBe(403);
    expect((await call('PUT', newerCookie, { enabled: true })).statusCode).toBe(403);
    const row = await prisma.setting.findFirst({
      where: { tenantId: newer!.tenantId, key: 'siteLinks' },
    });
    expect(row).toBeNull();
  });

  it('afiliado não lê nem altera → 403', async () => {
    expect((await call('GET', affCookie)).statusCode).toBe(403);
    expect((await call('PUT', affCookie, { enabled: true })).statusCode).toBe(403);
  });
});
