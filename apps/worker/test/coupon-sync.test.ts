import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import type { CouponUpsertInput } from '@afilados/marketplaces';
import { upsertCoupon } from '../src/lib/coupon-upsert';
import { createCouponSyncProcessor } from '../src/processors/coupon-sync';

const { publishEvent } = vi.hoisted(() => ({
  publishEvent: vi.fn(async () => {}),
}));
vi.mock('../src/lib/events', () => ({ publishEvent }));

let tenantId: string;
const now = new Date('2026-09-25T12:00:00.000Z');

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'coupon-sync-test' } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('upsertCoupon', () => {
  it('cria novo cupom com status UNVERIFIED e lastSeenAt=now', async () => {
    const input: CouponUpsertInput = {
      store: 'ALIEXPRESS',
      scope: '',
      advertiserName: null,
      code: 'NEWALI10',
      description: '10% off',
      terms: null,
      discountType: 'PERCENT',
      discountValue: 10,
      minSpend: null,
      startsAt: null,
      expiresAt: new Date('2026-12-31T23:59:59.000Z'),
      sourceUrl: 'https://pt.aliexpress.com/item/1.html',
      affiliateUrl: null,
      externalId: '1',
      remainingUses: 100,
    };

    const res = await upsertCoupon(tenantId, input, 'API', now);
    expect(res).toBe('created');

    const saved = await prisma.coupon.findUnique({
      where: { tenantId_store_code_scope: { tenantId, store: 'ALIEXPRESS', code: 'NEWALI10', scope: '' } },
    });
    expect(saved).not.toBeNull();
    expect(saved!.status).toBe('UNVERIFIED');
    expect(saved!.origin).toBe('API');
    expect(saved!.lastSeenAt).toEqual(now);
  });

  it('atualiza metadados sem alterar status VALID e sem alterar origin MANUAL', async () => {
    // Cupom criado manualmente e validado por humano
    const manual = await prisma.coupon.create({
      data: {
        tenantId,
        store: 'AWIN',
        scope: 'adv_1',
        code: 'MANUAL10',
        description: 'Descrição original',
        origin: 'MANUAL',
        status: 'VALID',
        lastSeenAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const input: CouponUpsertInput = {
      store: 'AWIN',
      scope: 'adv_1',
      advertiserName: 'Loja 1',
      code: 'MANUAL10',
      description: 'Nova descrição da API',
      terms: 'Termos atualizados',
      discountType: 'FIXED',
      discountValue: 20,
      minSpend: 100,
      startsAt: null,
      expiresAt: new Date('2026-12-31T23:59:59.000Z'),
      sourceUrl: 'https://loja.com',
      affiliateUrl: null,
      externalId: 'ext_1',
      remainingUses: 50,
    };

    const res = await upsertCoupon(tenantId, input, 'API', now);
    expect(res).toBe('updated');

    const updated = await prisma.coupon.findUnique({ where: { id: manual.id } });
    expect(updated!.status).toBe('VALID'); // Não rebaixou VALID
    expect(updated!.origin).toBe('MANUAL'); // Não trocou origin MANUAL
    expect(updated!.description).toBe('Nova descrição da API');
    expect(updated!.lastSeenAt).toEqual(now);
  });

  it('marca EXPIRED quando expiresAt < now e cria CouponCheck(EXPIRY)', async () => {
    const pastDate = new Date('2026-08-01T00:00:00.000Z');
    const input: CouponUpsertInput = {
      store: 'SHOPEE',
      scope: '',
      advertiserName: null,
      code: 'EXPIRED10',
      description: 'Cupom do passado',
      terms: null,
      discountType: 'PERCENT',
      discountValue: 10,
      minSpend: null,
      startsAt: null,
      expiresAt: pastDate,
      sourceUrl: null,
      affiliateUrl: null,
      externalId: null,
      remainingUses: null,
    };

    const res = await upsertCoupon(tenantId, input, 'API', now);
    expect(res).toBe('created');

    const saved = await prisma.coupon.findUnique({
      where: { tenantId_store_code_scope: { tenantId, store: 'SHOPEE', code: 'EXPIRED10', scope: '' } },
      include: { checks: true },
    });
    expect(saved!.status).toBe('EXPIRED');
    expect(saved!.checks.length).toBeGreaterThanOrEqual(1);
    expect(saved!.checks[0]!.result).toBe('EXPIRED');
    expect(saved!.checks[0]!.method).toBe('EXPIRY');
  });

  it('marca INVALID quando remainingUses=0 e cria CouponCheck(SOURCE)', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        tenantId,
        store: 'ALIEXPRESS',
        scope: '',
        code: 'ESGOTADO10',
        description: 'Cupom que vai esgotar',
        origin: 'API',
        status: 'UNVERIFIED',
      },
    });

    const input: CouponUpsertInput = {
      store: 'ALIEXPRESS',
      scope: '',
      advertiserName: null,
      code: 'ESGOTADO10',
      description: 'Cupom esgotado',
      terms: null,
      discountType: 'PERCENT',
      discountValue: 10,
      minSpend: null,
      startsAt: null,
      expiresAt: null,
      sourceUrl: null,
      affiliateUrl: null,
      externalId: null,
      remainingUses: 0,
    };

    const res = await upsertCoupon(tenantId, input, 'API', now);
    expect(res).toBe('updated');

    const updated = await prisma.coupon.findUnique({
      where: { id: coupon.id },
      include: { checks: true },
    });
    expect(updated!.status).toBe('INVALID');
    const sourceCheck = updated!.checks.find((c) => c.method === 'SOURCE');
    expect(sourceCheck).toBeDefined();
    expect(sourceCheck!.result).toBe('INVALID');
  });
});

describe('createCouponSyncProcessor', () => {
  it('sincroniza AliExpress, Awin e varredura de expiração com tratamento resiliente', async () => {
    // Configura conexões no banco para o tenant
    await prisma.marketplaceConnection.createMany({
      data: [
        {
          tenantId,
          kind: 'ALIEXPRESS',
          status: 'OK',
          encryptedCredentials: encryptJson({ appKey: 'k', appSecret: 's', trackingId: 't' }),
        },
        {
          tenantId,
          kind: 'AWIN',
          status: 'OK',
          encryptedCredentials: encryptJson({
            feedListUrl: 'https://feed.awin.com',
            feedIds: [],
            publisherId: 'pub_123',
            offersApiToken: 'tok_123',
          }),
        },
      ],
    });

    // Cria um cupom Awin antigo que NÃO virá na resposta da Awin (deve ser expirado)
    const oldAwinCoupon = await prisma.coupon.create({
      data: {
        tenantId,
        store: 'AWIN',
        scope: 'adv_999',
        code: 'AWINOLD',
        description: 'Cupom Awin sumido',
        origin: 'API',
        status: 'UNVERIFIED',
        lastSeenAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    // Cria um cupom AliExpress antigo que NÃO virá na resposta (NÃO deve ser expirado, pois é amostragem)
    const oldAliCoupon = await prisma.coupon.create({
      data: {
        tenantId,
        store: 'ALIEXPRESS',
        scope: '',
        code: 'ALIOLD',
        description: 'Cupom Ali de rodada anterior',
        origin: 'API',
        status: 'UNVERIFIED',
        lastSeenAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    // Cria um cupom vencido por data para a varredura pegar
    const expiredByDateCoupon = await prisma.coupon.create({
      data: {
        tenantId,
        store: 'AMAZON',
        code: 'AMZEXPDATE',
        description: 'Cupom com data passada',
        origin: 'MANUAL',
        status: 'UNVERIFIED',
        expiresAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    });

    const mockFetchAli = vi.fn().mockResolvedValue([
      {
        store: 'ALIEXPRESS',
        scope: '',
        advertiserName: null,
        code: 'ALISYNC1',
        description: 'Ali sync 1',
        terms: null,
        discountType: 'PERCENT',
        discountValue: 10,
        minSpend: null,
        startsAt: null,
        expiresAt: new Date('2026-12-31T23:59:59.000Z'),
        sourceUrl: null,
        affiliateUrl: null,
        externalId: 'ali_1',
        remainingUses: 10,
      },
    ]);

    const mockListAwin = vi.fn().mockResolvedValue([
      {
        store: 'AWIN',
        scope: 'adv_100',
        advertiserName: 'Loja Nova',
        code: 'AWINSYNC1',
        description: 'Awin sync 1',
        terms: null,
        discountType: null,
        discountValue: null,
        minSpend: null,
        startsAt: null,
        expiresAt: new Date('2026-12-31T23:59:59.000Z'),
        sourceUrl: null,
        affiliateUrl: null,
        externalId: 'awin_1',
        remainingUses: null,
      },
    ]);

    const processor = createCouponSyncProcessor({
      fetchAliexpressPromoCodes: mockFetchAli as any,
      listAwinVouchers: mockListAwin as any,
      now: () => now,
    });

    const results = await processor({
      data: { tenantId, trigger: 'schedule' },
    } as any);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ source: 'ALIEXPRESS', ok: true, created: 1 });
    expect(results[1]).toMatchObject({ source: 'AWIN', ok: true, created: 1, expired: 1 });
    expect(results[2]).toMatchObject({ source: 'EXPIRY', ok: true, expired: 1 });

    // Verifica que o cupom Awin sumido virou EXPIRED
    const checkAwinOld = await prisma.coupon.findUnique({ where: { id: oldAwinCoupon.id } });
    expect(checkAwinOld!.status).toBe('EXPIRED');

    // Verifica que o cupom AliExpress antigo NÃO expirou (amostragem)
    const checkAliOld = await prisma.coupon.findUnique({ where: { id: oldAliCoupon.id } });
    expect(checkAliOld!.status).toBe('UNVERIFIED');

    // Verifica que o cupom vencido por data virou EXPIRED
    const checkExpiredDate = await prisma.coupon.findUnique({ where: { id: expiredByDateCoupon.id } });
    expect(checkExpiredDate!.status).toBe('EXPIRED');

    // Verifica que o evento coupons.updated foi publicado
    expect(publishEvent).toHaveBeenCalledWith(tenantId, { type: 'coupons.updated' });
  });
});
