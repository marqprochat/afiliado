import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let root: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
let rootCookie: string;
let affCookie: string;

const cookiesOf = (r: { headers: Record<string, unknown> }) => {
  const sc = r.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : sc ? [String(sc)] : []) as string[];
};
const pairsOf = (r: { headers: Record<string, unknown> }) =>
  cookiesOf(r)
    .map((s) => s.split(';')[0]!)
    .filter((s) => !s.endsWith('='));
const call = (
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  cookie: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie },
    ...(payload ? { payload: payload as object } : {}),
  });

const OWNER_AI = {
  enabled: false,
  baseUrl: 'https://vps/v1',
  model: 'combo',
  encryptedApiKey: encryptJson({ apiKey: 'sk-test-1234' }).toString('base64'),
};
const setOwnerAi = (value: object) =>
  prisma.setting.update({
    where: { tenantId_key: { tenantId: root.tenantId, key: 'ai' } },
    data: { value },
  });

beforeAll(async () => {
  root = await createTenantWithUser('raiz');
  await prisma.user.update({ where: { id: root.userId }, data: { isSuperAdmin: true } });
  aff = await createTenantWithUser('afiliado', root.tenantId);
  await prisma.setting.create({ data: { tenantId: root.tenantId, key: 'ai', value: OWNER_AI } });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: root.tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'x', secret: 'y' }),
    },
  });
  rootCookie = await loginCookie(app, root.email, root.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
});
afterAll(async () => {
  await cleanupTenant(root.tenantId);
  await app.close();
});

describe('/me da conta raiz', () => {
  it('isAffiliate false e sem impersonação', async () => {
    const me = (await call('GET', '/me', rootCookie)).json();
    expect(me).toMatchObject({ isAffiliate: false, impersonating: null });
  });
});

describe('requireSuperAdmin', () => {
  it('afiliado (usuário comum) → 403 em /admin/affiliates', async () => {
    expect((await call('GET', '/admin/affiliates', affCookie)).statusCode).toBe(403);
  });
});

describe('forbidAffiliate (rotas de credencial)', () => {
  it('oauth/callback, DELETE oauth e awin/feeds → 403 para o afiliado', async () => {
    const cb = await call('POST', '/marketplaces/mercadolivre/oauth/callback', affCookie, {
      code: 'c',
      state: 's',
    });
    expect(cb.statusCode).toBe(403);
    expect((await call('DELETE', '/marketplaces/mercadolivre/oauth', affCookie)).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/marketplaces/awin/feeds', affCookie)).statusCode).toBe(403);
  });
});

describe('IA do afiliado', () => {
  it('GET esconde a chave do dono (apiKeyHint null) e PUT com model → 403', async () => {
    const get = (await call('GET', '/settings/ai', affCookie)).json();
    expect(get).toMatchObject({
      managed: true,
      available: true,
      hasApiKey: false,
      apiKeyHint: null,
    });
    expect(JSON.stringify(get)).not.toContain('1234');
    expect((await call('PUT', '/settings/ai', affCookie, { model: 'outro' })).statusCode).toBe(403);
  });

  it('/settings/ai/test com credenciais no corpo → 403', async () => {
    for (const body of [{ baseUrl: 'https://x/v1' }, { model: 'm' }, { apiKey: 'sk-x' }]) {
      expect((await call('POST', '/settings/ai/test', affCookie, body)).statusCode).toBe(403);
    }
  });

  it('PUTs do afiliado não alteram as linhas do dono (conexão e IA)', async () => {
    const snap = async () => ({
      conns: await prisma.marketplaceConnection.findMany({ where: { tenantId: root.tenantId } }),
      ai: await prisma.setting.findMany({ where: { tenantId: root.tenantId, key: 'ai' } }),
    });
    const before = await snap();
    expect(
      (await call('PUT', '/marketplaces/SHOPEE', affCookie, { subId: 'joao' })).statusCode,
    ).toBe(200);
    expect(
      (await call('PUT', '/settings/ai', affCookie, { tone: 'urgente', enabled: true })).statusCode,
    ).toBe(200);
    expect(await snap()).toEqual(before);
    // as preferências ficaram na linha do próprio afiliado
    const own = await prisma.setting.findFirstOrThrow({
      where: { tenantId: aff.tenantId, key: 'ai' },
    });
    expect(own.value).toMatchObject({ tone: 'urgente', enabled: true });
    await prisma.setting.deleteMany({ where: { tenantId: aff.tenantId, key: 'ai' } });
  });

  it('/settings/ai/test: URL do dono bloqueada → mensagem genérica para o afiliado, detalhe só para a raiz', async () => {
    await setOwnerAi({ ...OWNER_AI, baseUrl: 'http://127.0.0.1:9/v1' });
    try {
      const a = await call('POST', '/settings/ai/test', affCookie, {});
      expect(a.statusCode).toBe(400);
      expect(a.json().error.message).toBe('A IA está indisponível, fale com o administrador');
      expect(JSON.stringify(a.json())).not.toMatch(/127\.0\.0\.1|Base URL/);
      const r = await call('POST', '/settings/ai/test', rootCookie, {});
      expect(r.statusCode).toBe(400);
      expect(r.json().error.message).toMatch(/Base URL inválida/);
    } finally {
      await setOwnerAi(OWNER_AI);
    }
  });

  it('/settings/ai/test: chave do dono ilegível → mensagem genérica para o afiliado', async () => {
    await setOwnerAi({ ...OWNER_AI, baseUrl: 'https://1.1.1.1/v1', encryptedApiKey: 'lixo' });
    try {
      const a = await call('POST', '/settings/ai/test', affCookie, {});
      expect(a.statusCode).toBe(400);
      expect(a.json().error.message).toBe('A IA está indisponível, fale com o administrador');
      const r = await call('POST', '/settings/ai/test', rootCookie, {});
      expect(r.json().error.message).toMatch(/API key ausente/);
    } finally {
      await setOwnerAi(OWNER_AI);
    }
  });
});

describe('token de API (afil_)', () => {
  it('afiliado ativo cria token; depois de desativado, o token → 403 ACCOUNT_DISABLED', async () => {
    const created = (await call('POST', '/api-tokens', affCookie, { name: 'ext' })).json();
    expect(created.token).toMatch(/^afil_/);
    const auth = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/extension/auth',
        headers: { authorization: `Bearer ${created.token}` },
      });
    expect((await auth()).statusCode).toBe(200);
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: false } });
    try {
      const r = await auth();
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('ACCOUNT_DISABLED');
    } finally {
      await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: true } });
    }
  });

  it('afiliado ativo em /extension/session → 403', async () => {
    const r = await call('POST', '/extension/session', affCookie, {
      marketplaceKind: 'MERCADOLIVRE',
      cookies: { a: '1' },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('sessão de impersonação', () => {
  const impersonate = async () => {
    const r = await call('POST', `/admin/affiliates/${aff.tenantId}/impersonate`, rootCookie, {});
    expect(r.statusCode).toBe(204);
    const pairs = pairsOf(r);
    return {
      header: pairs.join('; '),
      session: pairs.find((s) => s.startsWith('afilados_session='))!,
      admin: pairs.find((s) => s.startsWith('afilados_admin_session='))!,
    };
  };

  it('continua válida com o tenant do afiliado inativo (SuperAdmin ainda entra)', async () => {
    const { session } = await impersonate();
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: false } });
    try {
      const me = await call('GET', '/me', session);
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        tenant: { id: aff.tenantId },
        impersonating: expect.any(Object),
      });
      // já a sessão normal do afiliado não vale
      expect((await call('GET', '/me', affCookie)).statusCode).toBe(401);
    } finally {
      await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: true } });
    }
  });

  it('o impersonador deixa de ser SuperAdmin → sessão inválida e apagada', async () => {
    await prisma.session.deleteMany({ where: { impersonatorUserId: root.userId } });
    const { session } = await impersonate();
    const mine = await prisma.session.findMany({
      where: { impersonatorUserId: root.userId },
      select: { id: true },
    });
    expect(mine).toHaveLength(1);
    expect((await call('GET', '/me', session)).statusCode).toBe(200);
    await prisma.user.update({ where: { id: root.userId }, data: { isSuperAdmin: false } });
    try {
      expect((await call('GET', '/me', session)).statusCode).toBe(401);
      expect(await prisma.session.count({ where: { id: mine[0]!.id } })).toBe(0);
    } finally {
      await prisma.user.update({ where: { id: root.userId }, data: { isSuperAdmin: true } });
    }
  });

  it('o impersonador deixa de existir → sessão inválida', async () => {
    const { session } = await impersonate();
    // Impersonador removido: a sessão aponta para um id que não existe mais.
    await prisma.session.updateMany({
      where: { userId: aff.userId, impersonatorUserId: { not: null } },
      data: { impersonatorUserId: 'usuario-apagado' },
    });
    expect((await call('GET', '/me', session)).statusCode).toBe(401);
  });

  it('logout encerra também a sessão do admin guardada', async () => {
    const { header, admin } = await impersonate();
    const out = await call('POST', '/auth/logout', header);
    expect(out.statusCode).toBe(204);
    const adminAsSession = admin.replace('afilados_admin_session=', 'afilados_session=');
    expect((await call('GET', '/me', adminAsSession)).statusCode).toBe(401);
  });
});
