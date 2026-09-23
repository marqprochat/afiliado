import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma, decryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

describe('API Tokens & Extension Routes (Fase 3)', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let cookie: string;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Extensao Teste');
    cookie = await loginCookie(app, t.email, t.password);
  });

  afterEach(async () => {
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  it('cria, lista e revoga API Tokens', async () => {
    // 1. Criar Token
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Meu Chrome em Casa' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.token).toMatch(/^afil_[a-f0-9]{48}$/);
    expect(created.name).toBe('Meu Chrome em Casa');
    expect(created.tokenHint).toHaveLength(4);

    const tokenId = created.id;
    const rawToken = created.token;

    // 2. Listar Tokens
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/api-tokens',
      headers: { cookie },
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0].tokenHint).toBe(created.tokenHint);

    // 3. Autenticar com o Token criado via /extension/auth
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/auth',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(authRes.statusCode).toBe(200);
    expect(authRes.json().ok).toBe(true);
    expect(authRes.json().tenantName).toBe('Tenant Extensao Teste');

    // 4. Revogar Token
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-tokens/${tokenId}`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(200);

    // 5. Tentar autenticar com o Token revogado deve falhar
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/auth',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(failRes.statusCode).toBe(401);
  });

  it('captura produto diretamente via extensão com metadados e coloca na fila de triagem', async () => {
    // Cria token
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Captura' },
    });
    const { token } = tokenRes.json();

    // Envia produto capturado
    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://www.amazon.com.br/dp/B09B8V1LZ3',
        marketplaceKind: 'AMAZON',
        title: 'Echo Dot 5a Geracao',
        price: 299.0,
        originalPrice: 429.0,
        images: ['https://m.media-amazon.com/foto1.jpg'],
        shipping: 'FREE',
      },
    });

    expect(captureRes.statusCode).toBe(200);
    const body = captureRes.json();
    expect(body.ok).toBe(true);
    expect(body.product.title).toBe('Echo Dot 5a Geracao');
    expect(body.product.price).toBe(299.0);
    expect(body.queueItem.status).toBe('PENDING');
    expect(body.queueItem.selected).toBe(true);

    // Verifica no banco
    const queueCount = await prisma.queueItem.count({
      where: { tenantId: t.tenantId },
    });
    expect(queueCount).toBe(1);
  });

  it('lista automações ativas do tenant em GET /extension/automations', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacoes' },
    });
    const { token } = tokenRes.json();

    const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 's' } });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const enabledRule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Ativa',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });
    await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Desligada',
        enabled: false,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/automations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((r: { id: string }) => r.id)).toContain(enabledRule.id);
    expect(list.map((r: { name: string }) => r.name)).not.toContain('Desligada');
  });

  it('captura com automationRuleId cria item na fila da automação, não na fila de triagem', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacao Captura' },
    });
    const { token } = tokenRes.json();

    const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 's2' } });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Destino',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://shopee.com.br/produto-x-i.111.222',
        marketplaceKind: 'SHOPEE',
        title: 'Produto Capturado Para Automação',
        price: 39.9,
        automationRuleId: rule.id,
      },
    });
    expect(captureRes.statusCode).toBe(200);

    const queueItems = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(queueItems.length).toBe(1);
    expect(queueItems[0]!.manual).toBe(true);
    expect(queueItems[0]!.status).toBe('PENDING');

    // Não deve ter ido para a Fila de Triagem
    const triageItems = await prisma.queueItem.findMany({
      where: { tenantId: t.tenantId, product: { title: 'Produto Capturado Para Automação' } },
    });
    expect(triageItems.length).toBe(0);
  });

  it('rejeita automationRuleId de outro tenant na captura → 404', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacao Foreign' },
    });
    const { token } = tokenRes.json();

    const other = await createTenantWithUser('extensao-outro-tenant');
    const otherSession = await prisma.waSession.create({ data: { tenantId: other.tenantId, label: 's3' } });
    const otherTemplate = await prisma.template.findFirstOrThrow({ where: { tenantId: other.tenantId } });
    const foreignRule = await prisma.automationRule.create({
      data: {
        tenantId: other.tenantId,
        name: 'De outro tenant',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: otherSession.id,
        groupJids: ['g@g.us'],
        templateId: otherTemplate.id,
      },
    });

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://shopee.com.br/produto-y-i.333.444',
        marketplaceKind: 'SHOPEE',
        title: 'Produto IDOR',
        price: 10,
        automationRuleId: foreignRule.id,
      },
    });
    expect(captureRes.statusCode).toBe(404);

    await cleanupTenant(other.tenantId);
  });

  it('aceita captura da extensão com campos opcionais nulos (nullish)', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Nullish Test' },
    });
    const { token } = tokenRes.json();

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://www.mercadolivre.com.br/produto-teste/p/MLB123',
        marketplaceKind: 'MERCADOLIVRE',
        title: 'Cafeteira Mondial Dolce Crema',
        price: 521.93,
        originalPrice: 967.0,
        discountPct: 46,
        images: ['https://http2.mlstatic.com/foto1.jpg'],
        shipping: 'FULL',
        couponCode: null,
        couponValue: null,
        flashSaleEndsAt: null,
        affiliateUrl: null,
      },
    });

    expect(captureRes.statusCode).toBe(200);
    const body = captureRes.json();
    expect(body.ok).toBe(true);
    expect(body.product.title).toBe('Cafeteira Mondial Dolce Crema');
    expect(body.product.price).toBe(521.93);
    expect(body.product.originalPrice).toBe(967.0);
    expect(body.product.couponCode).toBeNull();
  });

  it('sincroniza a sessão do ML criptografada, sem expor cookies, preservando matt_word/matt_tool', async () => {
    // Tags já configuradas pela F2
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattWord: 'afil123', mattTool: '99' },
    });

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Sessão' },
    });
    const { token } = tokenRes.json();

    const cookies = { orguseridp: '123456', ssid: 'sess-abc', _csrf: 'zzz' };
    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/session',
      headers: { authorization: `Bearer ${token}` },
      payload: { marketplaceKind: 'MERCADOLIVRE', cookies },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toMatchObject({
      ok: true,
      marketplaceKind: 'MERCADOLIVRE',
      cookieCount: 3,
    });

    // Persistido criptografado junto das credenciais, com as tags preservadas
    const row = await prisma.marketplaceConnection.findFirst({
      where: { tenantId: t.tenantId, kind: 'MERCADOLIVRE' },
    });
    expect(row?.encryptedCredentials).toBeTruthy();
    expect(Buffer.from(row!.encryptedCredentials!).toString('utf8')).not.toContain('sess-abc');
    const creds = decryptJson<TagCredentials>(Buffer.from(row!.encryptedCredentials!));
    expect(creds.mlSession?.cookies).toEqual(cookies);
    expect(creds.mattWord).toBe('afil123');
    expect(creds.mattTool).toBe('99');

    // A API pública só expõe o syncedAt
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplaces',
      headers: { cookie },
    });
    const ml = list.json().find((c: { kind: string }) => c.kind === 'MERCADOLIVRE');
    expect(ml.mlSessionSyncedAt).toBe(sync.json().syncedAt);
    expect(JSON.stringify(ml)).not.toContain('sess-abc');

    // Editar as tags depois não apaga a sessão
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MERCADOLIVRE',
      headers: { cookie },
      payload: { mattWord: 'novo', mattTool: '99' },
    });
    const row2 = await prisma.marketplaceConnection.findFirst({
      where: { tenantId: t.tenantId, kind: 'MERCADOLIVRE' },
    });
    const creds2 = decryptJson<TagCredentials>(Buffer.from(row2!.encryptedCredentials!));
    expect(creds2.mlSession?.cookies).toEqual(cookies);
    expect(creds2.mattWord).toBe('novo');

    // Só o Mercado Livre aceita sessão
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/session',
      headers: { authorization: `Bearer ${token}` },
      payload: { marketplaceKind: 'AMAZON', cookies },
    });
    expect(bad.statusCode).toBe(400);
  });
});
