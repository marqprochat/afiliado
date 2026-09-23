import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  other = await createTenantWithUser('o');
  cookie = await loginCookie(app, t.email, t.password);
  const s = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 'c', status: 'CONNECTED' },
  });
  sessionId = s.id;
  await prisma.waGroup.create({
    data: { tenantId: t.tenantId, sessionId, jid: 'g1@g.us', name: 'G1' },
  });
  templateId = (await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })).id;
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('automations routes', () => {
  let ruleId: string;

  it('cria uma regra', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/automations',
      headers: { cookie },
      payload: {
        name: 'Eletrônicos',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    expect(res.statusCode).toBe(201);
    ruleId = res.json().id;
    expect(res.json().enabled).toBe(false);
  });

  it('lista regras com estatísticas derivadas do log', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rule = res.json().find((r: { id: string }) => r.id === ruleId);
    expect(rule.stats).toEqual({
      freshCount: 0,
      discoveredToday: 0,
      dispatchedToday: 0,
      lastDispatchedAt: null,
    });
  });

  it('liga a automação (toggle)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/toggle`,
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
  });

  it('rejeita grupo que não pertence à sessão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/automations',
      headers: { cookie },
      payload: {
        name: 'x',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        sessionId,
        groupJids: ['inexistente@g.us'],
        templateId,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('adiciona cupom manual na fila com template próprio e lista como PENDING', async () => {
    const coupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    const couponTemplate = await prisma.template.create({
      data: { tenantId: t.tenantId, name: 'tc', body: '{codigo}', kind: 'COUPON' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/queue/coupon`,
      headers: { cookie },
      payload: { couponId: coupon.id, templateId: couponTemplate.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().templateId).toBe(couponTemplate.id);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe('COUPON');
    expect(items[0].manual).toBe(true);
  });

  it('rejeita couponId de outro tenant (IDOR) → 404', async () => {
    const foreignCoupon = await prisma.coupon.create({
      data: { tenantId: other.tenantId, store: 'AMAZON', code: 'FOREIGN10', description: 'de outro tenant' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/queue/coupon`,
      headers: { cookie },
      payload: { couponId: foreignCoupon.id, templateId },
    });
    expect(res.statusCode).toBe(404);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    expect(items.some((i: { couponId: string | null }) => i.couponId === foreignCoupon.id)).toBe(false);
  });

  it('rejeita templateId de outro tenant no cupom manual (IDOR) → 404', async () => {
    const ownCoupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'PROMO20', description: '20% off' },
    });
    const foreignTemplate = await prisma.template.create({
      data: { tenantId: other.tenantId, name: 'tf', body: '{codigo}', kind: 'COUPON' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/queue/coupon`,
      headers: { cookie },
      payload: { couponId: ownCoupon.id, templateId: foreignTemplate.id },
    });
    expect(res.statusCode).toBe(404);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    expect(items.some((i: { couponId: string | null }) => i.couponId === ownCoupon.id)).toBe(false);
  });

  it('rejeita PATCH parcial com groupJids desconhecido mesmo sem sessionId/templateId → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}`,
      headers: { cookie },
      payload: { groupJids: ['inexistente@g.us'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejeita PATCH parcial com templateId de outro tenant → 404', async () => {
    const foreignTemplate = await prisma.template.create({
      data: { tenantId: other.tenantId, name: 'tf2', body: 'x' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}`,
      headers: { cookie },
      payload: { templateId: foreignTemplate.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejeita link Amazon sem credenciais da Creators API configuradas → 400 (não 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/queue/link`,
      headers: { cookie },
      payload: { url: 'https://www.amazon.com.br/dp/B08N5WRWNW' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MARKETPLACE_ERROR');
  });

  it('reordena a fila via PATCH /queue/order e o GET reflete a nova ordem', async () => {
    const extraCoupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'SHOPEE', code: 'PROMO30', description: '30% off' },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId: t.tenantId, ruleId, kind: 'COUPON', couponId: extraCoupon.id, templateId, manual: true },
    });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId, status: 'PENDING' },
      orderBy: { position: 'asc' },
    });
    expect(items.length).toBeGreaterThanOrEqual(2);
    const reversedIds = items.map((i) => i.id).reverse();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: reversedIds },
    });
    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const ordered = listRes.json();
    expect(ordered.map((i: { id: string }) => i.id)).toEqual(reversedIds);
  });

  it('GET /queue devolve o marketplace de cada item', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    for (const item of items) {
      if (item.kind === 'PRODUCT') expect(item.marketplace).toBe(item.product.source);
      if (item.kind === 'COUPON') expect(item.marketplace).toBe(item.coupon.store);
    }
  });

  it('rejeita PATCH /queue/order com item de outra regra → 400', async () => {
    const otherRule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'outra-regra-order',
        marketplaces: ['SHOPEE'],
        keywords: ['x'],
        blockedKeywords: [],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const otherCoupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'OUTRAREGRA', description: 'x' },
    });
    const foreignItem = await prisma.automationQueueItem.create({
      data: { tenantId: t.tenantId, ruleId: otherRule.id, kind: 'COUPON', couponId: otherCoupon.id, templateId, manual: true },
    });
    const own = await prisma.automationQueueItem.findFirst({ where: { ruleId, status: 'PENDING' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: [foreignItem.id, own!.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejeita PATCH /queue/order que não cobre todos os itens pendentes da regra → 400', async () => {
    const own = await prisma.automationQueueItem.findMany({ where: { ruleId, status: 'PENDING' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: [own[0]!.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('remove item da fila', async () => {
    const [item] = await prisma.automationQueueItem.findMany({ where: { ruleId } });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/automations/${ruleId}/queue/${item!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const updated = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: item!.id } });
    expect(updated.status).toBe('REMOVED');
  });

  it('deleta a regra', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/automations/${ruleId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
  });
});
