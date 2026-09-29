import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A config da API é lida no import; as variáveis precisam existir antes de qualquer import.
vi.hoisted(() => {
  process.env.ML_CLIENT_ID = 'cid-test';
  process.env.ML_CLIENT_SECRET = 'secret-test';
  process.env.DESENVOLVIMENTO = 'true';
});

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { decryptJson, encryptJson, forTenant, prisma } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import { loadFetchCredentials } from '../src/lib/ml-api';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

function tokenResponse(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

const FIRST_TOKENS = { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 21600, user_id: 229863486 };

describe('OAuth da API oficial do Mercado Livre', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let cookie: string;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant ML OAuth');
    cookie = await loginCookie(app, t.email, t.password);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  async function start(withCookie = cookie) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/mercadolivre/oauth/start',
      headers: { cookie: withCookie },
    });
    return res;
  }

  async function callback(state: string, code = 'TG-abc', withCookie = cookie) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/mercadolivre/oauth/callback',
      headers: { cookie: withCookie },
      payload: { code, state },
    });
  }

  async function connect() {
    const started = await start();
    const state = new URL(started.json().authUrl).searchParams.get('state')!;
    vi.stubGlobal('fetch', tokenResponse(FIRST_TOKENS));
    return callback(state);
  }

  async function storedCreds(): Promise<TagCredentials> {
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'MERCADOLIVRE' },
    });
    return decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials!));
  }

  it('exige sessão do painel', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/mercadolivre/oauth/start' });
    expect(res.statusCode).toBe(401);
  });

  it('start devolve a URL de autorização com PKCE, state e o redirect do modo desenvolvimento', async () => {
    const res = await start();
    expect(res.statusCode).toBe(200);
    const { authUrl, redirectUri } = res.json();
    expect(redirectUri).toBe('http://localhost:3000/callback');
    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe('https://auth.mercadolivre.com.br/authorization');
    expect(url.searchParams.get('client_id')).toBe('cid-test');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/);
    expect(authUrl).not.toContain('secret-test');
  });

  it('callback troca o código, grava a conexão criptografada e não devolve token nem segredo', async () => {
    const res = await connect();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ kind: 'MERCADOLIVRE', hasMlApi: true, mlApiAvailable: true });
    expect(body.mlApiConnectedAt).toEqual(expect.any(String));
    const raw = res.body;
    for (const secret of ['acc-1', 'ref-1', 'secret-test']) expect(raw).not.toContain(secret);

    const creds = await storedCreds();
    expect(creds.mlApi).toMatchObject({ refreshToken: 'ref-1', accessToken: 'acc-1', userId: '229863486' });
  });

  it('o state é de uso único', async () => {
    const started = await start();
    const state = new URL(started.json().authUrl).searchParams.get('state')!;
    vi.stubGlobal('fetch', tokenResponse(FIRST_TOKENS));
    expect((await callback(state)).statusCode).toBe(200);
    expect((await callback(state)).statusCode).toBe(400);
  });

  it('state desconhecido é recusado sem chamar o Mercado Livre', async () => {
    const fetchMock = tokenResponse(FIRST_TOKENS);
    vi.stubGlobal('fetch', fetchMock);
    const res = await callback('0'.repeat(32));
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state gerado por outro tenant é recusado', async () => {
    const other = await createTenantWithUser('Tenant ML Outro');
    try {
      const otherCookie = await loginCookie(app, other.email, other.password);
      const started = await start(otherCookie);
      const state = new URL(started.json().authUrl).searchParams.get('state')!;
      const fetchMock = tokenResponse(FIRST_TOKENS);
      vi.stubGlobal('fetch', fetchMock);
      const res = await callback(state); // sessão do tenant A usando o state do tenant B
      expect(res.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await cleanupTenant(other.tenantId);
    }
  });

  it('código recusado pelo Mercado Livre vira 400 sem vazar segredo', async () => {
    const started = await start();
    const state = new URL(started.json().authUrl).searchParams.get('state')!;
    vi.stubGlobal('fetch', tokenResponse({ error: 'invalid_grant', message: 'Error validating grant' }, 400));
    const res = await callback(state);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid_grant');
    expect(res.body).not.toContain('secret-test');
  });

  it('salvar o formulário do Mercado Livre não apaga a conexão da API', async () => {
    await connect();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattWord: 'meu-afiliado', mattTool: '123456' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ hasMlApi: true, mattWord: 'meu-afiliado' });
    expect((await storedCreds()).mlApi?.refreshToken).toBe('ref-1');
  });

  it('DELETE remove só a conexão da API e preserva o resto', async () => {
    await connect();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattWord: 'meu-afiliado', mattTool: '123456' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/marketplaces/mercadolivre/oauth',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hasMlApi: false, mattWord: 'meu-afiliado' });
    const creds = await storedCreds();
    expect(creds.mlApi).toBeUndefined();
    expect(creds.mattWord).toBe('meu-afiliado');
  });
});

describe('POST /products/search (Mercado Livre pela API oficial)', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let cookie: string;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant ML Busca');
    cookie = await loginCookie(app, t.email, t.password);
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: t.tenantId,
        kind: 'MERCADOLIVRE',
        status: 'OK',
        encryptedCredentials: encryptJson({
          mlApi: {
            refreshToken: 'ref-1',
            accessToken: 'acc-1',
            expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
          },
        }) as never,
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  function stubMlApi(routes: Record<string, { status: number; body?: unknown }>) {
    const hosts: string[] = [];
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = new URL(String(input));
        hosts.push(u.host);
        paths.push(u.pathname);
        const r = routes[u.pathname] ?? { status: 404, body: { message: 'No winners found' } };
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body ?? {},
          text: async () => JSON.stringify(r.body ?? {}),
        };
      }),
    );
    return { hosts, paths };
  }

  const search = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/products/search',
      headers: { cookie },
      payload: { source: 'MERCADOLIVRE', mode: 'keyword', query: 'fone', limit: 20, ...payload },
    });

  const routes = {
    '/products/search': {
      status: 200,
      body: { results: [{ id: 'MLB111', name: 'Fone A' }, { id: 'MLB222', name: 'Fone B' }] },
    },
    '/products/MLB111/items': {
      status: 200,
      body: { results: [{ item_id: 'MLB9', price: 44.55, condition: 'new', seller_id: 1 }] },
    },
    '/products/MLB111': {
      status: 200,
      body: { id: 'MLB111', name: 'Fone A', pictures: [{ url: 'https://http2.mlstatic.com/D_1.jpg' }] },
    },
    // MLB222 sem oferta: 404 "No winners found" (produto indisponível)
  };

  it('busca no catálogo pela API, descarta produto sem oferta e nunca raspa o site', async () => {
    const seen = stubMlApi(routes);

    const res = await search();

    expect(res.statusCode).toBe(200);
    const { products } = res.json();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ title: 'Fone A', source: 'MERCADOLIVRE' });
    expect(Number(products[0].price)).toBe(44.55);
    expect(seen.paths).toContain('/products/search');
    expect(new Set(seen.hosts)).toEqual(new Set(['api.mercadolibre.com']));
  });

  it('aplica a faixa de preço da busca sobre os produtos da API', async () => {
    stubMlApi(routes);
    const res = await search({ maxPrice: 30 });
    expect(res.statusCode).toBe(200);
    expect(res.json().products).toEqual([]);
  });

  it('erro de acesso da API vira 502 com mensagem clara', async () => {
    stubMlApi({ '/products/search': { status: 403, body: { message: 'forbidden' } } });
    const res = await search();
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('recusou o acesso');
  });
});

describe('loadFetchCredentials (Mercado Livre)', () => {
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;

  beforeEach(async () => {
    t = await createTenantWithUser('Tenant ML Token');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTenant(t.tenantId);
  });

  async function seed(mlApi: NonNullable<TagCredentials['mlApi']>) {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: t.tenantId,
        kind: 'MERCADOLIVRE',
        status: 'OK',
        encryptedCredentials: encryptJson({ mattWord: 'meu-afiliado', mlApi }) as never,
      },
    });
  }

  async function stored(): Promise<TagCredentials> {
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'MERCADOLIVRE' },
    });
    return decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials!));
  }

  it('reaproveita o access token válido sem chamar a API', async () => {
    await seed({
      refreshToken: 'ref-1',
      accessToken: 'acc-1',
      expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });
    const fetchMock = tokenResponse({});
    vi.stubGlobal('fetch', fetchMock);

    const creds = await loadFetchCredentials(forTenant(t.tenantId), 'MERCADOLIVRE');

    expect(creds.mlApi?.accessToken).toBe('acc-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renova o token vencido e grava o novo refresh_token no banco', async () => {
    await seed({
      refreshToken: 'ref-1',
      accessToken: 'acc-velho',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
      connectedAt: '2026-09-29T10:00:00.000Z',
    });
    vi.stubGlobal('fetch', tokenResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 21600 }));

    const creds = await loadFetchCredentials(forTenant(t.tenantId), 'MERCADOLIVRE');

    expect(creds.mlApi?.accessToken).toBe('acc-2');
    const saved = await stored();
    expect(saved.mlApi).toMatchObject({ refreshToken: 'ref-2', accessToken: 'acc-2', connectedAt: '2026-09-29T10:00:00.000Z' });
    expect(saved.mattWord).toBe('meu-afiliado');
  });

  it('refresh recusado devolve as credenciais sem mlApi (adapter mantém a raspagem) e registra o erro', async () => {
    await seed({
      refreshToken: 'ref-usado',
      accessToken: 'acc-velho',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    vi.stubGlobal('fetch', tokenResponse({ error: 'invalid_grant', message: 'refresh usado' }, 400));

    const creds = await loadFetchCredentials(forTenant(t.tenantId), 'MERCADOLIVRE');

    expect(creds.mlApi).toBeUndefined();
    expect(creds.mattWord).toBe('meu-afiliado');
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'MERCADOLIVRE' },
    });
    expect(row.lastError).toContain('desconectada');
    expect((await stored()).mlApi?.refreshToken).toBe('ref-usado');
  });

  it('sem conexão devolve credenciais vazias e Magalu não precisa de nada', async () => {
    expect(await loadFetchCredentials(forTenant(t.tenantId), 'MERCADOLIVRE')).toEqual({});
    expect(await loadFetchCredentials(forTenant(t.tenantId), 'MAGALU')).toEqual({});
  });
});
