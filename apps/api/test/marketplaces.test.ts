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
  it('amazon: salva tag e testa conexão', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'minha-20' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ kind: 'AMAZON', affiliateTag: 'minha-20' });
    const check = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/AMAZON/check',
      headers: { cookie },
    });
    expect(check.json()).toMatchObject({ status: 'OK' });
  });
  it('mercado livre: exige matt_word e matt_tool juntos', async () => {
    const put1 = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattWord: 'minhaid' },
    });
    expect(put1.json()).toMatchObject({ status: 'UNCONFIGURED' });
    const check1 = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MERCADOLIVRE/check',
      headers: { cookie },
    });
    expect(check1.json()).toMatchObject({ status: 'ERROR' });

    const put2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattTool: '12345678' },
    });
    expect(put2.json()).toMatchObject({
      mattWord: 'minhaid',
      mattTool: '12345678',
      status: 'UNCONFIGURED',
    });
    const check2 = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MERCADOLIVRE/check',
      headers: { cookie },
    });
    expect(check2.json()).toMatchObject({ status: 'OK' });
  });
  it('magalu sem tag → check falha com UNCONFIGURED/ERROR', async () => {
    const check = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MAGALU/check',
      headers: { cookie },
    });
    expect(check.statusCode).toBe(400); // Sem credenciais
  });
});
