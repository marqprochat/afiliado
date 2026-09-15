import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
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
});
