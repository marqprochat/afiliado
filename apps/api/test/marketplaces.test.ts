import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, decryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

process.env.SHOPEE_MOCK = '1';
const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('marketplaces', () => {
  it('lista as 4 lojas como UNCONFIGURED', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } });
    expect(r.json().map((c: { kind: string; status: string }) => [c.kind, c.status])).toEqual([
      ['SHOPEE', 'UNCONFIGURED'],
      ['MERCADOLIVRE', 'UNCONFIGURED'],
      ['AMAZON', 'UNCONFIGURED'],
      ['MAGALU', 'UNCONFIGURED'],
    ]);
  });
  it('PUT shopee criptografa e nunca devolve o secret', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/SHOPEE',
      headers: { cookie },
      payload: { appId: 'app1', secret: 's3cr3t', affiliateTag: 'tag' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      kind: 'SHOPEE',
      appId: 'app1',
      hasSecret: true,
      affiliateTag: 'tag',
    });
    expect(JSON.stringify(r.json())).not.toContain('s3cr3t');
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'SHOPEE' },
    });
    expect(decryptJson(Buffer.from(row.encryptedCredentials!))).toEqual({
      appId: 'app1',
      secret: 's3cr3t',
    });
  });
  it('PUT parcial preserva o secret', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/SHOPEE',
      headers: { cookie },
      payload: { appId: 'app2' },
    });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'SHOPEE' },
    });
    expect(decryptJson(Buffer.from(row.encryptedCredentials!))).toEqual({
      appId: 'app2',
      secret: 's3cr3t',
    });
  });
  it('check marca OK (modo mock)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/SHOPEE/check',
      headers: { cookie },
    });
    expect(r.json()).toMatchObject({ status: 'OK', lastError: null });
    expect(r.json().lastCheckedAt).toBeTruthy();
  });
  it('outras lojas → 400 na F1', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'x' },
    });
    expect(r.statusCode).toBe(400);
  });
});
