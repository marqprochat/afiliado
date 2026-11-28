import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '@afilados/db';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const DAY = 86_400_000;

describe('extensão: GET /extension/coupons só devolve cupom utilizável', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof createTenantWithUser>>;
  let auth: { authorization: string };

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    t = await createTenantWithUser('Tenant Extensao Cupons');
    const cookie = await loginCookie(app, t.email, t.password);
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Chrome' },
    });
    auth = { authorization: `Bearer ${tokenRes.json().token}` };
  });

  afterEach(async () => {
    await cleanupTenant(t.tenantId);
    await app.close();
  });

  const base = { store: 'SHOPEE' as const, status: 'VALID' as const, origin: 'MANUAL' as const };

  async function codes(query: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/extension/coupons?store=SHOPEE${query}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    return res.json().coupons.map((c: { code: string }) => c.code).sort();
  }

  it('descarta vencido, futuro, sem usos, gasto mínimo acima do preço e captura automática', async () => {
    await prisma.coupon.createMany({
      data: [
        { ...base, tenantId: t.tenantId, code: 'OK', description: 'ok' },
        {
          ...base,
          tenantId: t.tenantId,
          code: 'OLD',
          description: 'vencido, mas ainda marcado VALID',
          expiresAt: new Date(Date.now() - DAY),
        },
        {
          ...base,
          tenantId: t.tenantId,
          code: 'FUTURE',
          description: 'ainda não começou',
          startsAt: new Date(Date.now() + DAY),
        },
        { ...base, tenantId: t.tenantId, code: 'NOUSES', description: 'esgotado', remainingUses: 0 },
        { ...base, tenantId: t.tenantId, code: 'MIN500', description: 'min', minSpend: 500 },
        {
          ...base,
          tenantId: t.tenantId,
          code: 'GUESS',
          description: 'visto em página',
          status: 'UNVERIFIED',
          origin: 'EXTENSION',
        },
        {
          ...base,
          tenantId: t.tenantId,
          code: 'MANUALUNV',
          description: 'cadastrado à mão, não verificado',
          status: 'UNVERIFIED',
        },
      ],
    });

    // sem preço: o gasto mínimo não filtra (não dá para saber)
    expect(await codes('')).toEqual(['MANUALUNV', 'MIN500', 'OK']);
    // produto de R$ 100: MIN500 não se aplica
    expect(await codes('&price=100')).toEqual(['MANUALUNV', 'OK']);
    // produto de R$ 800: MIN500 se aplica
    expect(await codes('&price=800')).toEqual(['MANUALUNV', 'MIN500', 'OK']);
  });
});
