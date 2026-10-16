// Erros de marketplace/IA do dono nunca vazam o detalhe técnico para o afiliado (spec §6).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const h = vi.hoisted(() => ({
  importResults: [] as unknown[],
  categoriesError: new Error('AliExpress app key inválida: segredo-do-dono'),
}));

vi.mock('../src/lib/redis', async (orig) => {
  const real = await orig<typeof import('../src/lib/redis')>();
  return {
    ...real,
    getQueue: () => ({
      add: async () => ({ waitUntilFinished: async () => h.importResults }),
    }),
    getQueueEvents: () => ({}),
  };
});
vi.mock('@afilados/marketplaces', async (orig) => {
  const real = await orig<typeof import('@afilados/marketplaces')>();
  return {
    ...real,
    getAliexpressCategories: async () => {
      throw h.categoriesError;
    },
  };
});
vi.mock('@afilados/core', async (orig) => {
  const real = await orig<typeof import('@afilados/core')>();
  return {
    ...real,
    generateCta: async () => {
      throw new real.AiCtaError('http', 'provedor respondeu 500 em https://vps/v1', 500);
    },
  };
});
vi.mock('@afilados/core/safe-url', () => ({ assertPublicHttpUrl: async () => undefined }));

import { prisma, encryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let root: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
let rootCookie: string;
let affCookie: string;
const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie },
    ...(payload ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  root = await createTenantWithUser('raiz');
  aff = await createTenantWithUser('afiliado', root.tenantId);
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: root.tenantId,
      kind: 'AWIN',
      encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/x', feedIds: ['f1'] }),
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: root.tenantId,
      kind: 'ALIEXPRESS',
      encryptedCredentials: encryptJson({ appKey: 'k', appSecret: 's', trackingId: 't' }),
    },
  });
  await prisma.setting.create({
    data: {
      tenantId: root.tenantId,
      key: 'ai',
      value: {
        enabled: false,
        baseUrl: 'https://vps/v1',
        model: 'combo',
        encryptedApiKey: encryptJson({ apiKey: 'sk-test-1234' }).toString('base64'),
      },
    },
  });
  rootCookie = await loginCookie(app, root.email, root.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
});
afterAll(async () => {
  await cleanupTenant(root.tenantId);
  await app.close();
});

const GENERIC = 'Marketplace indisponível, fale com o administrador';

describe('awin/import', () => {
  it('afiliado recebe erro genérico por feed; a raiz vê o detalhe', async () => {
    h.importResults = [
      {
        feedId: 'f1',
        ok: false,
        imported: 0,
        removed: 0,
        error: 'HTTP 403 em https://awin/feed?key=SEGREDO',
      },
      { feedId: 'f2', ok: true, imported: 5, removed: 0 },
    ];
    const a = (await call('POST', '/marketplaces/awin/import', affCookie, {})).json();
    expect(a.failedCount).toBe(1);
    expect(a.feeds[0].error).toBe(GENERIC);
    expect(JSON.stringify(a)).not.toContain('SEGREDO');
    expect(a.feeds[1]).toEqual({ feedId: 'f2', ok: true, imported: 5, removed: 0 });
    const r = (await call('POST', '/marketplaces/awin/import', rootCookie, {})).json();
    expect(r.feeds[0].error).toContain('SEGREDO');
  });
});

describe('aliexpress/categories', () => {
  it('afiliado → 502 genérico; raiz → 502 com a mensagem original', async () => {
    const a = await call('GET', '/marketplaces/aliexpress/categories', affCookie);
    expect(a.statusCode).toBe(502);
    expect(a.json().error).toMatchObject({
      code: 'MARKETPLACE_UNAVAILABLE',
      message: GENERIC,
    });
    expect(a.body).not.toContain('segredo-do-dono');
    const r = await call('GET', '/marketplaces/aliexpress/categories', rootCookie);
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toContain('segredo-do-dono');
  });
});

describe('/settings/ai/test com erro do provedor', () => {
  it('afiliado → 502 genérico; raiz → 502 com o detalhe', async () => {
    const a = await call('POST', '/settings/ai/test', affCookie, {});
    expect(a.statusCode).toBe(502);
    expect(a.json().error.message).toBe('A IA está indisponível, fale com o administrador');
    expect(a.body).not.toContain('vps');
    const r = await call('POST', '/settings/ai/test', rootCookie, {});
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toContain('provedor respondeu 500');
  });
});
