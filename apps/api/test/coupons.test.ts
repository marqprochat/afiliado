import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let otherCookie: string;

beforeAll(async () => {
  t = await createTenantWithUser('CouponsTenant');
  other = await createTenantWithUser('OtherCouponsTenant');
  cookie = await loginCookie(app, t.email, t.password);
  otherCookie = await loginCookie(app, other.email, other.password);
});

afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('coupons routes', () => {
  let createdCouponId: string;

  it('cria cupom manual com status VALID e origin MANUAL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons',
      headers: { cookie },
      payload: {
        store: 'SHOPEE',
        code: 'promo10',
        description: '10% de desconto',
        discountType: 'PERCENT',
        discountValue: 10,
        minSpend: 50,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe('PROMO10'); // normalizado em maiúsculas
    expect(body.status).toBe('VALID');
    expect(body.origin).toBe('MANUAL');
    expect(body.discountValue).toBe(10);
    expect(body.minSpend).toBe(50);
    createdCouponId = body.id;
  });

  it('retorna 409 ao tentar criar cupom duplicado para mesma loja e tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons',
      headers: { cookie },
      payload: {
        store: 'SHOPEE',
        code: 'PROMO10',
        description: 'Outra descrição',
      },
    });

    expect(res.statusCode).toBe(409);
  });

  it('permite criar cupom com mesmo código em outro tenant (isolamento)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons',
      headers: { cookie: otherCookie },
      payload: {
        store: 'SHOPEE',
        code: 'PROMO10',
        description: 'Outro tenant',
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('lista cupons do tenant ordenados por status e validade, escondendo EXPIRED por padrão', async () => {
    // Cria cupom expirado
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'SHOPEE',
        code: 'EXPIRADO',
        description: 'Cupom velho',
        status: 'EXPIRED',
        origin: 'MANUAL',
      },
    });

    // Cria cupom unverified
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'SHOPEE',
        code: 'UNVERIFIED1',
        description: 'Cupom não verificado',
        status: 'UNVERIFIED',
        origin: 'IMPORT',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/coupons',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const { coupons } = res.json();
    expect(coupons.some((c: any) => c.code === 'EXPIRADO')).toBe(false);
    expect(coupons.length).toBe(2);
    // VALID deve vir antes de UNVERIFIED
    expect(coupons[0].status).toBe('VALID');
    expect(coupons[1].status).toBe('UNVERIFIED');

    // Com includeExpired=true, o expirado aparece
    const resAll = await app.inject({
      method: 'GET',
      url: '/api/v1/coupons?includeExpired=true',
      headers: { cookie },
    });
    expect(resAll.statusCode).toBe(200);
    expect(resAll.json().coupons.some((c: any) => c.code === 'EXPIRADO')).toBe(true);
  });

  it('edita campos do formulário via PUT sem alterar status nem origin', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/coupons/${createdCouponId}`,
      headers: { cookie },
      payload: {
        store: 'SHOPEE',
        code: 'PROMO10',
        description: 'Descrição atualizada',
        discountType: 'FIXED',
        discountValue: 15,
        minSpend: 60,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.description).toBe('Descrição atualizada');
    expect(body.discountType).toBe('FIXED');
    expect(body.discountValue).toBe(15);
    expect(body.status).toBe('VALID');
    expect(body.origin).toBe('MANUAL');
  });

  it('verifica cupom via POST /coupons/:id/verify e registra CouponCheck', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/coupons/${createdCouponId}/verify`,
      headers: { cookie },
      payload: {
        result: 'INVALID',
        note: 'Testado no carrinho e falhou',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('INVALID');
    expect(body.lastVerifiedAt).toBeDefined();

    // Consulta histórico de checagens
    const checksRes = await app.inject({
      method: 'GET',
      url: `/api/v1/coupons/${createdCouponId}/checks`,
      headers: { cookie },
    });
    expect(checksRes.statusCode).toBe(200);
    const { checks } = checksRes.json();
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(checks[0].result).toBe('INVALID');
    expect(checks[0].method).toBe('MANUAL');
    expect(checks[0].note).toBe('Testado no carrinho e falhou');
  });

  it('faz parse de cupons em texto livre e indica se já existem no banco', async () => {
    const text = `
      Super descontos da Shopee:
      Use o cupom PROMO10 para R$15 OFF
      Use o cupom NOVINHO20 para 20% OFF acima de R$100
    `;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons/parse',
      headers: { cookie },
      payload: { text, store: 'SHOPEE' },
    });

    expect(res.statusCode).toBe(200);
    const { candidates } = res.json();
    expect(candidates.length).toBe(2);

    const promo10 = candidates.find((c: any) => c.code === 'PROMO10');
    expect(promo10).toBeDefined();
    expect(promo10.exists).toBe(true);

    const novinho20 = candidates.find((c: any) => c.code === 'NOVINHO20');
    expect(novinho20).toBeDefined();
    expect(novinho20.exists).toBe(false);
  });

  it('importa cupons em lote via POST /coupons/bulk pulando duplicados', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons/bulk',
      headers: { cookie },
      payload: {
        coupons: [
          {
            store: 'SHOPEE',
            code: 'PROMO10', // já existe
            description: 'Duplicado',
          },
          {
            store: 'SHOPEE',
            code: 'NOVINHO20', // novo
            description: '20% OFF',
            discountType: 'PERCENT',
            discountValue: 20,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it('retorna 400 em /coupons/sync se nenhuma fonte automática estiver configurada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/coupons/sync',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Nenhuma fonte automática configurada');
  });

  it('retorna 409 em DELETE /coupons/:id se houver BatchItem referenciando o cupom', async () => {
    const s = await prisma.waSession.create({
      data: { tenantId: t.tenantId, label: 's-coupon', status: 'CONNECTED' },
    });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const product = await prisma.product.create({
      data: {
        tenantId: t.tenantId,
        source: 'SHOPEE',
        title: 'Produto Teste',
        price: 50,
        originalUrl: 'https://shopee.com.br/product-123',
        raw: {},
      },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId: t.tenantId,
        sessionId: s.id,
        templateId: template.id,
        name: 'Lote com cupom',
        groupJids: ['g@g.us'],
        intervalMin: 5,
        items: {
          create: [{ productId: product.id, couponId: createdCouponId, order: 0, runAt: new Date() }],
        },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/coupons/${createdCouponId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('já usado em envios');

    // Remove o batch para permitir limpeza posterior
    await prisma.batch.delete({ where: { id: batch.id } });
    await prisma.waSession.delete({ where: { id: s.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('remove cupom via DELETE /coupons/:id com 204 quando desvinculado', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/coupons/${createdCouponId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/coupons`,
      headers: { cookie },
    });
    expect(getRes.json().coupons.some((c: any) => c.id === createdCouponId)).toBe(false);
  });
});
