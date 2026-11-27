import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

describe('extensão: renderizar mensagem com o template do destino', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let auth: { authorization: string };
  let sessionId: string;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Extensao Render');
    const cookie = await loginCookie(app, t.email, t.password);
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Chrome' },
    });
    auth = { authorization: `Bearer ${tokenRes.json().token}` };
    sessionId = (
      await prisma.waSession.create({
        data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
      })
    ).id;
  });

  afterEach(async () => {
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  const offer = {
    link: 'https://meli.la/abc',
    title: 'Fone Bluetooth',
    price: 99.9,
    couponCode: 'BLACK10',
  };

  it('sem destino usa o template padrão da conta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/render-message',
      headers: auth,
      payload: offer,
    });
    expect(res.statusCode).toBe(200);
    // o template padrão do helper é '{titulo} {link}'
    expect(res.json().text).toBe('Fone Bluetooth https://meli.la/abc');
  });

  it('com lote usa o template do lote', async () => {
    const tpl = await prisma.template.create({
      data: {
        tenantId: t.tenantId,
        name: 'Do lote',
        body: '🔥 {titulo}\n💰 {preco}\n🎟️ {cupom}\n{link}',
      },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId: t.tenantId,
        sessionId,
        templateId: tpl.id,
        name: 'Lote X',
        groupJids: ['g1@g.us'],
        intervalMin: 10,
        status: 'SCHEDULED',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/render-message',
      headers: auth,
      payload: { ...offer, batchId: batch.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().templateName).toBe('Do lote');
    expect(res.json().text).toContain('🎟️ BLACK10');
    expect(res.json().text).toContain('https://meli.la/abc');
    expect(res.json().text).toContain('99,90');
  });

  it('lote inexistente retorna 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/render-message',
      headers: auth,
      payload: { ...offer, batchId: 'nao-existe' },
    });
    expect(res.statusCode).toBe(404);
  });
});
