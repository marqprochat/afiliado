import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload: payload as object } : {}) });

beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'SHOPEE', status: 'OK', encryptedCredentials: encryptJson({ appId: 'x', secret: 'y' }) },
  });
  await prisma.setting.create({
    data: { tenantId: owner.tenantId, key: 'ai',
      value: { enabled: false, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: encryptJson({ apiKey: 'sk-test-1234' }).toString('base64') } },
  });
  cookie = await loginCookie(app, aff.email, aff.password);
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('marketplaces do afiliado', () => {
  it('lista 6 lojas com status do dono, sem credenciais, e salva só subId', async () => {
    const put = await call('PUT', '/marketplaces/SHOPEE', { subId: ' joao ' });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ kind: 'SHOPEE', subId: 'joao', status: 'OK' });
    const list = (await call('GET', '/marketplaces')).json();
    expect(list).toHaveLength(6);
    const shopee = list.find((c: { kind: string }) => c.kind === 'SHOPEE');
    expect(shopee).toMatchObject({ subId: 'joao', hasSecret: false, appId: null });
  });
  it('rejeita campos de credencial (400) e rotas de credencial (403)', async () => {
    expect((await call('PUT', '/marketplaces/SHOPEE', { appId: 'x', secret: 'y' })).statusCode).toBe(400);
    expect((await call('POST', '/marketplaces/SHOPEE/check')).statusCode).toBe(403);
    expect((await call('POST', '/marketplaces/MERCADOLIVRE/session', { cookie: 'a=1' })).statusCode).toBe(403);
    expect((await call('POST', '/marketplaces/mercadolivre/oauth/start')).statusCode).toBe(403);
    expect((await call('POST', '/extension/session', { marketplaceKind: 'MERCADOLIVRE', cookies: { a: '1' } })).statusCode).toBe(403);
  });
});

describe('IA gerenciada', () => {
  it('GET esconde conexão e informa que está disponível', async () => {
    expect((await call('GET', '/settings/ai')).json()).toMatchObject({
      managed: true, available: true, baseUrl: '', model: '', hasApiKey: false,
    });
  });
  it('PUT aceita preferências, mas rejeita baseUrl/model/apiKey (403)', async () => {
    const ok = await call('PUT', '/settings/ai', { tone: 'urgente', enabled: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tone: 'urgente', enabled: true });
    expect((await call('PUT', '/settings/ai', { baseUrl: 'https://x' })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/ai', { apiKey: 'sk-x' })).statusCode).toBe(403);
    const ownRow = await prisma.setting.findFirstOrThrow({ where: { tenantId: aff.tenantId, key: 'ai' } });
    expect(ownRow.value).not.toHaveProperty('baseUrl', 'https://x');
  });
});
