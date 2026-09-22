import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
  it('lista as 6 lojas como UNCONFIGURED', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/marketplaces', headers: { cookie } });
    expect(r.json().map((c: { kind: string; status: string }) => [c.kind, c.status])).toEqual([
      ['SHOPEE', 'UNCONFIGURED'],
      ['MERCADOLIVRE', 'UNCONFIGURED'],
      ['AMAZON', 'UNCONFIGURED'],
      ['MAGALU', 'UNCONFIGURED'],
      ['AWIN', 'UNCONFIGURED'],
      ['ALIEXPRESS', 'UNCONFIGURED'],
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
  it('amazon: salva Client ID/Secret da Creators API, nunca devolve o secret, e check valida via API', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'api-20', amazonClientId: 'cid-1', amazonClientSecret: 's3gredo' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      kind: 'AMAZON',
      affiliateTag: 'api-20',
      amazonClientId: 'cid-1',
      hasAmazonApiSecret: true,
    });
    expect(JSON.stringify(put.json())).not.toContain('s3gredo');

    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonApi?: { clientId: string; clientSecret: string } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonApi).toEqual({ clientId: 'cid-1', clientSecret: 's3gredo' });

    // check valida via API: mocka o fetch global (getAccessToken + GetItems da Creators API)
    // para não bater na rede real e confirma que a rota de check chega a chamar a API.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (String(url).includes('/auth/o2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemResults: { items: [{ asin: 'B08N5WRWNW' }] } }),
      };
    }) as unknown as typeof fetch);
    try {
      const check = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplaces/AMAZON/check',
        headers: { cookie },
      });
      expect(check.json()).toMatchObject({ status: 'OK' });
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('amazon: PUT parcial sem os dois campos da API preserva amazonApi já salvo', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { amazonClientId: 'cid-2', amazonClientSecret: 's3gredo2' },
    });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'outra-tag-20' },
    });
    expect(put.json()).toMatchObject({ hasAmazonApiSecret: true, amazonClientId: 'cid-2' });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonApi?: { clientId: string; clientSecret: string } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonApi).toEqual({ clientId: 'cid-2', clientSecret: 's3gredo2' });
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

  it('rejeita cookie de sessão para SHOPEE', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/SHOPEE/session',
      headers: { cookie },
      payload: { cookie: 'algumvalor' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejeita cookie apenas com espaços em branco para MERCADOLIVRE (400, não persiste sessão vazia)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MERCADOLIVRE/session',
      headers: { cookie },
      payload: { cookie: '   ' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('aceita cookie manual para AMAZON, marca status OK e nunca devolve o valor do cookie', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/AMAZON/session',
      headers: { cookie },
      payload: { cookie: 'session-id=abc; ubid-acbbr=xyz' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ kind: 'AMAZON', status: 'OK' });
    expect(r.json().amazonSessionSyncedAt).toBeTruthy();
    expect(r.json().amazonSessionSource).toBe('manual');
    expect(JSON.stringify(r.json())).not.toContain('abc');

    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonSession?: { cookies: Record<string, string> } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonSession?.cookies).toEqual({ 'session-id': 'abc', 'ubid-acbbr': 'xyz' });
  });

  it('PUT da tag preserva a sessão de cookie já salva (não destrói amazonSession)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/AMAZON/session',
      headers: { cookie },
      payload: { cookie: 'session-id=preserved; ubid-acbbr=xyz' },
    });
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AMAZON',
      headers: { cookie },
      payload: { affiliateTag: 'nova-tag-20' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({ kind: 'AMAZON', affiliateTag: 'nova-tag-20' });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ tag?: string; amazonSession?: { cookies: Record<string, string> } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.tag).toBe('nova-tag-20');
    expect(creds.amazonSession?.cookies).toEqual({ 'session-id': 'preserved', 'ubid-acbbr': 'xyz' });
  });

  it('cookie manual preserva a tag já salva do mesmo marketplace', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MAGALU',
      headers: { cookie },
      payload: { affiliateTag: 'minhaloja' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MAGALU/session',
      headers: { cookie },
      payload: { cookie: 'tokenunico' },
    });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'MAGALU' },
    });
    const creds = decryptJson<{ tag?: string; magaluSession?: { cookies: Record<string, string> } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.tag).toBe('minhaloja');
    expect(creds.magaluSession?.cookies).toEqual({ magalu_session: 'tokenunico' });
  });

  it('PUT AWIN salva feedListUrl/feedIds, sem nunca devolver o link (contém a API key)', async () => {
    const feedListUrl = 'https://ui.awin.com/productdata-darwin-download/publisher/1/segredo123/1/feedList';
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie },
      payload: { feedListUrl, feedIds: ['111', '222'] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      kind: 'AWIN',
      hasAwinFeedListUrl: true,
      awinFeedIds: ['111', '222'],
    });
    expect(JSON.stringify(r.json())).not.toContain('segredo123');
    expect(JSON.stringify(r.json())).not.toContain(feedListUrl);
  });

  it('PUT AWIN rejeita link de host inválido (400)', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie },
      payload: { feedListUrl: 'https://evil.example/feedList' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('PUT AWIN com link novo preserva feedIds já selecionados quando não enviados', async () => {
    const feedListUrl1 = 'https://ui.awin.com/productdata-darwin-download/publisher/1/k1/1/feedList';
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie },
      payload: { feedListUrl: feedListUrl1, feedIds: ['111'] },
    });
    const feedListUrl2 = 'https://ui.awin.com/productdata-darwin-download/publisher/1/k2/1/feedList';
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie },
      payload: { feedListUrl: feedListUrl2 },
    });
    expect(r.json()).toMatchObject({ awinFeedIds: ['111'] });
  });

  it('GET /marketplaces/awin/feeds sem link configurado responde 400', async () => {
    const other = await createTenantWithUser();
    const otherCookie = await loginCookie(app, other.email, other.password);
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces/awin/feeds',
      headers: { cookie: otherCookie },
    });
    expect(r.statusCode).toBe(400);
    await cleanupTenant(other.tenantId);
  });

  it('GET /marketplaces/awin/feeds propaga erro da Awin como MARKETPLACE_ERROR (502)', async () => {
    const other = await createTenantWithUser();
    const otherCookie = await loginCookie(app, other.email, other.password);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie: otherCookie },
      payload: { feedListUrl: 'https://ui.awin.com/feedList/badkey' },
    });
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation((async () => ({ ok: false, status: 401 })) as unknown as typeof fetch);
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/api/v1/marketplaces/awin/feeds',
        headers: { cookie: otherCookie },
      });
      expect(r.statusCode).toBe(502);
      expect(r.json()).toMatchObject({ error: { code: 'MARKETPLACE_ERROR' } });
    } finally {
      fetchSpy.mockRestore();
      await cleanupTenant(other.tenantId);
    }
  });

  it('PUT ALIEXPRESS salva appKey/appSecret/trackingId sem expor o secret', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/ALIEXPRESS',
      headers: { cookie },
      payload: { appKey: 'key_123', appSecret: 'sec_456', trackingId: 'track_789' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      kind: 'ALIEXPRESS',
      aliexpressAppKey: 'key_123',
      hasAliexpressAppSecret: true,
      aliexpressTrackingId: 'track_789',
    });
    expect(JSON.stringify(r.json())).not.toContain('sec_456');
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'ALIEXPRESS' },
    });
    expect(decryptJson(Buffer.from(row.encryptedCredentials!))).toEqual({
      appKey: 'key_123',
      appSecret: 'sec_456',
      trackingId: 'track_789',
    });
  });

  it('POST /marketplaces/awin/import enfileira o job quando há feeds selecionados', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/awin/import', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ queued: true });
  });

  it('POST /marketplaces/awin/import sem credenciais configuradas responde com erro, não enfileira', async () => {
    const other = await createTenantWithUser();
    const otherCookie = await loginCookie(app, other.email, other.password);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/awin/import',
      headers: { cookie: otherCookie },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: { code: 'MARKETPLACE_ERROR' } });
    await cleanupTenant(other.tenantId);
  });

  it('POST /marketplaces/awin/import com feedListUrl mas sem seleção responde 400, não enfileira', async () => {
    const other = await createTenantWithUser();
    const otherCookie = await loginCookie(app, other.email, other.password);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/AWIN',
      headers: { cookie: otherCookie },
      payload: { feedListUrl: 'https://ui.awin.com/feedList/x' },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/awin/import',
      headers: { cookie: otherCookie },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: { code: 'MARKETPLACE_ERROR' } });
    await cleanupTenant(other.tenantId);
  });
});
