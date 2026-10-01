import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { QUEUE_SEND_OFFER } from '@afilados/shared';
import { buildApp } from '../src/app';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;
let offSessionId: string;
let couponTemplateId: string;
let productTemplateId: string;
let validCouponId: string;
let secondCouponId: string;
let expiredCouponId: string;
let foreignCouponId: string;

const targets = () => ({
  sessionId,
  groupJids: ['g1@g.us'],
  telegramChatIds: [] as string[],
});

beforeAll(async () => {
  t = await createTenantWithUser('DispatchTenant');
  other = await createTenantWithUser('DispatchOther');
  cookie = await loginCookie(app, t.email, t.password);
  await getQueue(QUEUE_SEND_OFFER).drain();
  sessionId = (
    await prisma.waSession.create({
      data: { tenantId: t.tenantId, label: 'c', status: 'CONNECTED' },
    })
  ).id;
  offSessionId = (
    await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 'off' } })
  ).id;
  await prisma.waGroup.create({
    data: { tenantId: t.tenantId, sessionId, jid: 'g1@g.us', name: 'G1' },
  });
  productTemplateId = (
    await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })
  ).id;
  couponTemplateId = (
    await prisma.template.create({
      data: { tenantId: t.tenantId, name: 'Cupom', body: '{codigo} {loja}', kind: 'COUPON' },
    })
  ).id;
  validCouponId = (
    await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'SHOPEE', code: 'VALIDO10', description: '10% off', status: 'VALID' },
    })
  ).id;
  secondCouponId = (
    await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'SEGUNDO5', description: '5% off', status: 'VALID' },
    })
  ).id;
  expiredCouponId = (
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'SHOPEE',
        code: 'VELHO',
        description: 'expirado',
        status: 'EXPIRED',
        expiresAt: new Date('2020-01-01'),
      },
    })
  ).id;
  foreignCouponId = (
    await prisma.coupon.create({
      data: { tenantId: other.tenantId, store: 'SHOPEE', code: 'ALHEIO', description: 'x', status: 'VALID' },
    })
  ).id;
});

afterAll(async () => {
  await getQueue(QUEUE_SEND_OFFER).drain();
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

function dispatch(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/coupons/dispatch', headers: { cookie }, payload });
}
function manual(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/manual-send', headers: { cookie }, payload });
}

describe('POST /coupons/dispatch', () => {
  it('fila: cria lote com os cupons elegíveis, lista os ignorados e enfileira os jobs', async () => {
    const res = await dispatch({
      couponIds: [validCouponId, expiredCouponId, secondCouponId],
      templateId: couponTemplateId,
      mode: 'queue',
      intervalMin: 15,
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemCount).toBe(2);
    expect(body.mode).toBe('queue');
    expect(body.skipped).toEqual([{ id: expiredCouponId, code: 'VELHO', reason: 'expired' }]);

    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: body.batchId },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    expect(batch.name.startsWith('Cupons ')).toBe(true);
    expect(batch.intervalMin).toBe(15);
    expect(batch.templateId).toBe(couponTemplateId);
    expect(batch.items.map((i) => i.couponId)).toEqual([validCouponId, secondCouponId]);
    const job = await getQueue(QUEUE_SEND_OFFER).getJob(batch.items[0]!.id);
    expect(job).toBeTruthy();
  });

  it('agora: todos os itens saem com runAt = agora', async () => {
    const before = Date.now();
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: res.json().batchId },
      include: { items: true },
    });
    const diff = Math.abs(batch.items[0]!.runAt.getTime() - before);
    expect(diff).toBeLessThan(10_000);
    expect(batch.intervalMin).toBe(1);
  });

  it('422 quando nenhum cupom é elegível', async () => {
    const res = await dispatch({
      couponIds: [expiredCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('cupom de outro tenant é tratado como não encontrado', async () => {
    const res = await dispatch({
      couponIds: [foreignCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(422);
    expect(await prisma.batch.count({ where: { tenantId: other.tenantId } })).toBe(0);
  });

  it('400 quando o template não é do tipo cupom', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: productTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 quando a sessão do WhatsApp está desconectada', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      sessionId: offSessionId,
      groupJids: ['g1@g.us'],
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 para grupo desconhecido', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      sessionId,
      groupJids: ['nao-existe@g.us'],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /manual-send', () => {
  it('cria lote de uma mensagem livre com texto e imagem', async () => {
    const res = await manual({
      text: '  Aviso importante  ',
      imageUrl: 'https://img.example/a.jpg',
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemCount).toBe(1);
    expect(body.skipped).toEqual([]);
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: body.batchId },
      include: { items: true },
    });
    expect(batch.name.startsWith('Envio manual ')).toBe(true);
    expect(batch.items[0]!.customText).toBe('Aviso importante');
    expect(batch.items[0]!.customImageUrl).toBe('https://img.example/a.jpg');
    expect(batch.items[0]!.productId).toBeNull();
    expect(batch.items[0]!.couponId).toBeNull();
    expect(await getQueue(QUEUE_SEND_OFFER).getJob(batch.items[0]!.id)).toBeTruthy();
  });

  it('fila: agenda o item pela janela de operação', async () => {
    const res = await manual({ text: 'Depois', mode: 'queue', intervalMin: 5, ...targets() });
    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().firstRunAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('400 com texto vazio e com sessão desconectada', async () => {
    expect((await manual({ text: '   ', mode: 'now', ...targets() })).statusCode).toBe(400);
    expect(
      (
        await manual({
          text: 'oi',
          mode: 'now',
          sessionId: offSessionId,
          groupJids: ['g1@g.us'],
        })
      ).statusCode,
    ).toBe(400);
  });
});
