import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { AWIN_WEBHOOK_TOKEN_KEY } from '@afilados/shared';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
const token = `tok${Date.now()}AbCdEfGhIjKlMnOpQrStUvWxYz0123`;
let groupId: string;

beforeAll(async () => {
  t = await createTenantWithUser('awin-webhook');
  await prisma.setting.create({
    data: { tenantId: t.tenantId, key: AWIN_WEBHOOK_TOKEN_KEY, value: token },
  });
  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
  });
  groupId = (
    await prisma.waGroup.create({
      data: {
        tenantId: t.tenantId,
        sessionId: session.id,
        jid: 'wh@g.us',
        name: 'Grupo Webhook',
        trackCode: 'wHook1',
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('POST /webhooks/awin/:token', () => {
  it('token válido: grava a venda (source WEBHOOK) com o canal pelo clickRef2', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/awin/${token}`,
      payload: {
        id: 'wh-1',
        advertiserId: 9999,
        commissionStatus: 'pending',
        commissionAmount: { amount: 5.5, currency: 'BRL' },
        saleAmount: { amount: 55, currency: 'BRL' },
        clickRefs: { clickRef: 'aff', clickRef2: 'wHook1', clickRef3: 'loteW' },
        transactionDate: '2026-11-24T10:00:00',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, received: 1 });
    const sale = await prisma.affiliateSale.findFirstOrThrow({
      where: { tenantId: t.tenantId, externalId: 'wh-1' },
    });
    expect(sale).toMatchObject({ source: 'WEBHOOK', channelId: groupId, batchId: 'loteW' });
    expect(sale.raw).toMatchObject({ id: 'wh-1' });
  });

  it('aceita formato achatado em form-urlencoded', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/awin/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        'transactionId=wh-2&merchantId=8888&commission=3.10&saleAmount=31&status=approved&clickRef2=wHook1',
    });
    expect(res.statusCode).toBe(200);
    const sale = await prisma.affiliateSale.findFirstOrThrow({
      where: { tenantId: t.tenantId, externalId: 'wh-2' },
    });
    expect(sale.status).toBe('APPROVED');
    expect(Number(sale.commissionAmount)).toBe(3.1);
  });

  it('token inválido → 404 e nada é gravado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/awin/token-errado',
      payload: { id: 'wh-x', advertiserId: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.affiliateSale.count({ where: { externalId: 'wh-x' } })).toBe(0);
  });

  it('corpo sem transação válida → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/awin/${token}`,
      payload: { foo: 'bar' },
    });
    expect(res.statusCode).toBe(400);
  });
});
