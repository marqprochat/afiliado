import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

describe('POST /extension/discover (descoberta pela extensão)', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let auth: { authorization: string };
  let ruleId: string;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Discover Teste');
    const cookie = await loginCookie(app, t.email, t.password);
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Chrome' },
    });
    auth = { authorization: `Bearer ${tokenRes.json().token}` };

    const session = await prisma.waSession.create({
      data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
    });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Fones',
        enabled: true,
        marketplaces: ['MERCADOLIVRE'],
        keywords: ['fone bluetooth'],
        blockedKeywords: ['capa'],
        maxPrice: 300,
        sessionId: session.id,
        templateId: template.id,
      },
    });
    ruleId = rule.id;
  });

  afterEach(async () => {
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  const payload = () => ({
    automationRuleId: ruleId,
    keyword: 'fone bluetooth',
    marketplaceKind: 'MERCADOLIVRE',
    items: [
      { url: 'https://www.mercadolivre.com.br/fone-bluetooth-x/p/MLB111', title: 'Fone Bluetooth X', price: 99.9, originalPrice: 199.8 },
      { url: 'https://produto.mercadolivre.com.br/MLB-222-fone-bluetooth-y', title: 'Fone Bluetooth Y', price: 250 },
      { url: 'https://produto.mercadolivre.com.br/MLB-333-capa-fone-bluetooth', title: 'Capa para Fone Bluetooth', price: 20 },
      { url: 'https://produto.mercadolivre.com.br/MLB-444-fone-bluetooth-caro', title: 'Fone Bluetooth Caro', price: 900 },
      { url: 'https://produto.mercadolivre.com.br/MLB-555-mouse-gamer', title: 'Mouse Gamer', price: 80 },
    ],
  });

  it('enfileira só o que passa nos filtros da regra e não duplica na segunda busca', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/v1/extension/discover', headers: auth, payload: payload() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ received: 5, accepted: 2, queued: 2 });

    const queued = await prisma.automationQueueItem.findMany({
      where: { ruleId },
      include: { product: true },
    });
    expect(queued.map((q) => q.product?.title).sort()).toEqual(['Fone Bluetooth X', 'Fone Bluetooth Y']);
    expect(queued.every((q) => q.manual === false)).toBe(true);
    expect(queued.find((q) => q.product?.title === 'Fone Bluetooth X')?.product?.discountPct).toBe(50);
    expect(await prisma.automationLog.count({ where: { ruleId, action: 'DISCOVERED' } })).toBe(2);

    const second = await app.inject({ method: 'POST', url: '/api/v1/extension/discover', headers: auth, payload: payload() });
    expect(second.json()).toMatchObject({ accepted: 2, queued: 0 });
    expect(await prisma.automationQueueItem.count({ where: { ruleId } })).toBe(2);
  });

  it('rejeita sem token e regra inexistente', async () => {
    const noAuth = await app.inject({ method: 'POST', url: '/api/v1/extension/discover', payload: payload() });
    expect(noAuth.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/discover',
      headers: auth,
      payload: { ...payload(), automationRuleId: 'nao-existe' },
    });
    expect(missing.statusCode).toBe(404);
  });
});
