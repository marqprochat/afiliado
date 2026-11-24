import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let tenantId: string;
let cookie: string;
const future = new Date(Date.now() + 7 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

async function makeDeal(slug: string, source: 'SHOPEE' | 'AMAZON', externalId: string) {
  const master = await prisma.masterProduct.create({
    data: {
      tenantId,
      title: slug,
      cleanTitle: slug,
      slug,
      lowestPriceEver: 50,
      averagePrice30d: 50,
      currentBestPrice: 50,
    },
  });
  await prisma.productListing.create({
    data: {
      tenantId,
      masterProductId: master.id,
      source,
      storeName: source,
      externalId,
      title: slug,
      originalUrl: `https://loja.test/${externalId}`,
      affiliateUrl: `https://aff.test/${externalId}`,
      currentPrice: 50,
    },
  });
}

const getDeal = (slug: string) =>
  app.inject({ method: 'GET', url: `/api/v1/deals/${slug}`, headers: { cookie } });

beforeAll(async () => {
  const t = await createTenantWithUser('DealsCoupons');
  tenantId = t.tenantId;
  cookie = await loginCookie(app, t.email, t.password);
  await makeDeal('fone-com-cupom-0001', 'SHOPEE', 'sp-1');
  await makeDeal('fone-sem-cupom-0001', 'SHOPEE', 'sp-2');
  await makeDeal('livro-amazon-0001', 'AMAZON', 'B0LIVRO001');
  await prisma.product.create({
    data: {
      tenantId,
      source: 'SHOPEE',
      externalId: 'sp-1',
      title: 'Fone',
      price: 50,
      images: [],
      originalUrl: 'https://loja.test/sp-1',
      raw: {},
      couponCode: 'FONE10',
      couponValue: 10,
    },
  });
  await prisma.product.create({
    data: {
      tenantId,
      source: 'SHOPEE',
      externalId: 'sp-2',
      title: 'Fone 2',
      price: 50,
      images: [],
      originalUrl: 'https://loja.test/sp-2',
      raw: {},
    },
  });
  const coupon = (
    store: 'SHOPEE' | 'AMAZON',
    code: string,
    discountType: 'PERCENT' | 'FIXED',
    discountValue: number,
    status: 'VALID' | 'INVALID',
    expiresAt: Date | null,
  ) => ({ tenantId, store, code, description: `desc ${code}`, discountType, discountValue, status, expiresAt });
  await prisma.coupon.createMany({
    data: [
      coupon('SHOPEE', 'SHOP5', 'PERCENT', 5, 'VALID', future),
      coupon('SHOPEE', 'SHOP20', 'FIXED', 20, 'VALID', null),
      coupon('SHOPEE', 'SHOP15', 'PERCENT', 15, 'VALID', future),
      coupon('SHOPEE', 'SHOP1', 'PERCENT', 1, 'VALID', future),
      coupon('SHOPEE', 'VENCIDO', 'PERCENT', 90, 'VALID', past),
      coupon('SHOPEE', 'INVALIDO', 'PERCENT', 80, 'INVALID', future),
      coupon('AMAZON', 'AMZ10', 'PERCENT', 10, 'VALID', null),
    ],
  });
});

afterAll(async () => {
  await cleanupTenant(tenantId);
  await app.close();
});

describe('GET /api/v1/deals/:slug — cupons', () => {
  it('devolve o cupom capturado com o produto da melhor listagem', async () => {
    const res = await getDeal('fone-com-cupom-0001');
    expect(res.statusCode).toBe(200);
    expect(res.json().coupons).toEqual([
      {
        code: 'FONE10',
        description: 'Cupom desta oferta',
        discountLabel: 'R$ 10,00 OFF',
        expiresAt: null,
      },
    ]);
  });

  it('sem cupom no produto, devolve até 3 cupons válidos da loja por desconto decrescente', async () => {
    const res = await getDeal('fone-sem-cupom-0001');
    expect(res.statusCode).toBe(200);
    const coupons = res.json().coupons as { code: string; discountLabel: string }[];
    expect(coupons.map((c) => c.code)).toEqual(['SHOP20', 'SHOP15', 'SHOP5']);
    expect(coupons[0]!.discountLabel).toBe('R$ 20,00 OFF');
    expect(coupons[1]!.discountLabel).toBe('15% OFF');
  });

  it('ignora expirados, inválidos e cupons de outra loja', async () => {
    const res = await getDeal('livro-amazon-0001');
    expect(res.json().coupons.map((c: { code: string }) => c.code)).toEqual(['AMZ10']);
  });
});
