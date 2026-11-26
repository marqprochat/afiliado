import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let noCreds: Awaited<ReturnType<typeof createTenantWithUser>>;
let ownerCookie: string;
let noCredsCookie: string;

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
/** Anunciantes que a Awin recusa no lote (deeplinkNotPermitted). */
let refused = new Set<number>();
let quota = { limit: 50, usage: 12 };

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, ...(init ? { init } : {}) });
  if (url.includes('/programmes')) {
    return res(200, [
      { id: 68224, name: 'Drogal BR', displayUrl: 'https://www.drogal.com.br' },
      { id: 7777, name: 'Loja Sete', displayUrl: 'https://www.lojasete.com.br' },
    ]);
  }
  if (url.endsWith('/linkbuilder/generate-batch')) {
    const { requests } = JSON.parse(String(init?.body)) as {
      requests: { advertiserId: number; destinationUrl: string; parameters?: { clickref?: string } }[];
    };
    return res(200, {
      responses: requests.map((r) =>
        refused.has(r.advertiserId)
          ? { status: 400, body: { error: 'deeplinkNotPermitted' }, request: r }
          : {
              status: 200,
              body: {
                url: `https://www.awin1.com/cread.php?awinmid=${r.advertiserId}&api=1&ref=${r.parameters?.clickref ?? ''}`,
              },
              request: r,
            },
      ),
    });
  }
  if (url.endsWith('/linkbuilder/quota')) return res(200, { publisherId: 12345, ...quota });
  return res(404, {});
});

beforeAll(async () => {
  owner = await createTenantWithUser('awin-links-owner');
  noCreds = await createTenantWithUser('awin-links-nocreds');
  ownerCookie = await loginCookie(app, owner.email, owner.password);
  noCredsCookie = await loginCookie(app, noCreds.email, noCreds.password);
  await prisma.marketplaceConnection.create({
    data: {
      tenantId: owner.tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({
        feedListUrl: 'https://ui.awin.com/f',
        feedIds: [],
        publisherId: '12345',
        offersApiToken: 'tok',
      }),
    },
  });
});

beforeEach(() => {
  calls = [];
  refused = new Set();
  quota = { limit: 50, usage: 12 };
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await cleanupTenant(noCreds.tenantId);
  await app.close();
});

function batch(cookie: string, items: { url: string; subId?: string }[]) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/marketplaces/awin/links/batch',
    headers: { cookie },
    payload: { items },
  });
}

describe('POST /marketplaces/awin/links/batch', () => {
  it('converte parceiros numa chamada de lote; não parceiro vira erro por item', async () => {
    const r = await batch(ownerCookie, [
      { url: 'https://www.drogal.com.br/produto-a/p', subId: 'campanha1' },
      { url: 'https://naoparceiro.com.br/x' },
      { url: 'https://www.lojasete.com.br/item' },
    ]);
    expect(r.statusCode).toBe(200);
    const { items } = r.json();
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      input: 'https://www.drogal.com.br/produto-a/p',
      url: 'https://www.awin1.com/cread.php?awinmid=68224&api=1&ref=campanha1',
      source: 'api',
    });
    expect(items[1]).toMatchObject({ input: 'https://naoparceiro.com.br/x', url: null });
    expect(items[1].error).toMatch(/parceiro/);
    expect(items[2]).toMatchObject({ source: 'api', url: expect.stringContaining('awinmid=7777') });
    const batchCalls = calls.filter((c) => c.url.endsWith('/generate-batch'));
    expect(batchCalls).toHaveLength(1);
    expect(JSON.parse(String(batchCalls[0]!.init?.body)).requests).toHaveLength(2);
  });

  it('item recusado pela Awin cai no link canônico', async () => {
    refused = new Set([7777]);
    const r = await batch(ownerCookie, [
      { url: 'https://www.lojasete.com.br/item', subId: 's1' },
      { url: 'https://www.drogal.com.br/b' },
    ]);
    const { items } = r.json();
    expect(items[0]).toMatchObject({ source: 'canonical' });
    expect(items[0].url).toBe(
      'https://www.awin1.com/cread.php?awinmid=7777&awinaffid=12345&platform=dl&ued=https%3A%2F%2Fwww.lojasete.com.br%2Fitem&clickref=s1',
    );
    expect(items[1]).toMatchObject({ source: 'api' });
  });

  it('link cread.php colado é reaproveitado (anunciante e destino) sem requisitá-lo', async () => {
    const cread =
      'https://www.awin1.com/cread.php?awinmid=7777&awinaffid=1&ued=https%3A%2F%2Fwww.lojasete.com.br%2Fz';
    const r = await batch(ownerCookie, [{ url: cread }]);
    expect(r.json().items[0]).toMatchObject({ source: 'api', url: expect.stringContaining('awinmid=7777') });
    const body = JSON.parse(
      String(calls.find((c) => c.url.endsWith('/generate-batch'))!.init?.body),
    );
    expect(body.requests[0]).toMatchObject({
      advertiserId: 7777,
      destinationUrl: 'https://www.lojasete.com.br/z',
    });
  });

  it('nunca requisita awin1.com (só api.awin.com)', async () => {
    await batch(ownerCookie, [
      { url: 'https://www.awin1.com/cread.php?awinmid=7777&ued=https%3A%2F%2Fwww.lojasete.com.br%2Fz' },
      { url: 'https://www.awin1.com/pclick.php?p=1&a=2&m=3' },
      { url: 'https://www.drogal.com.br/x' },
    ]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(new URL(c.url).hostname).toBe('api.awin.com');
  });

  it('valida o corpo (1..200 itens)', async () => {
    expect((await batch(ownerCookie, [])).statusCode).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ url: `https://www.drogal.com.br/${i}` }));
    expect((await batch(ownerCookie, many)).statusCode).toBe(400);
  });

  it('sem Publisher ID → 400', async () => {
    const r = await batch(noCredsCookie, [{ url: 'https://www.drogal.com.br/x' }]);
    expect(r.statusCode).toBe(400);
  });

  it('exige login', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/awin/links/batch',
      payload: { items: [{ url: 'https://www.drogal.com.br/x' }] },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('cota e links curtos', () => {
  it('GET quota devolve a cota (com cache) e o setting desligado por padrão', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/links/quota',
      headers: { cookie: ownerCookie },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({
      enabled: false,
      available: true,
      quota: { limit: 50, usage: 12, remaining: 38 },
    });
    quota = { limit: 50, usage: 40 };
    const r2 = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/links/quota',
      headers: { cookie: ownerCookie },
    });
    expect(r2.json().quota.usage).toBe(12);
    expect(calls.filter((c) => c.url.endsWith('/quota')).length).toBeLessThanOrEqual(1);
  });

  it('PUT short-links liga e desliga o setting', async () => {
    const put = (enabled: boolean) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/marketplaces/awin/short-links',
        headers: { cookie: ownerCookie },
        payload: { enabled },
      });
    expect((await put(true)).json()).toEqual({ enabled: true });
    const row = await prisma.setting.findFirst({
      where: { tenantId: owner.tenantId, key: 'awinShortLinks' },
    });
    expect(row?.value).toBe(true);
    const q = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/links/quota',
      headers: { cookie: ownerCookie },
    });
    expect(q.json().enabled).toBe(true);
    expect((await put(false)).json()).toEqual({ enabled: false });
  });

  it('sem credenciais: available=false e sem chamar a Awin', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/links/quota',
      headers: { cookie: noCredsCookie },
    });
    expect(r.json()).toEqual({ enabled: false, available: false, quota: null });
    expect(calls).toHaveLength(0);
  });
});
