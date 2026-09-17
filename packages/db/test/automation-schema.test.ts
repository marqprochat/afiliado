import { describe, it, expect } from 'vitest';
import { prisma } from '../src';

describe('schema de automação', () => {
  it('cria AutomationRule + AutomationQueueItem (produto) + AutomationQueueItem (cupom com template próprio)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'automation-schema-test' } });
    const session = await prisma.waSession.create({
      data: { tenantId: tenant.id, label: 's' },
    });
    const template = await prisma.template.create({
      data: { tenantId: tenant.id, name: 't', body: 'oi', kind: 'PRODUCT' },
    });
    const couponTemplate = await prisma.template.create({
      data: { tenantId: tenant.id, name: 'tc', body: '{codigo}', kind: 'COUPON' },
    });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: 'Eletrônicos',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });
    expect(rule.enabled).toBe(false);

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        source: 'SHOPEE',
        title: 'Fone X',
        price: 99.9,
        images: ['https://x/img.png'],
        originalUrl: 'https://shopee.com.br/p/1',
        raw: {},
      },
    });
    const queueItem = await prisma.automationQueueItem.create({
      data: { tenantId: tenant.id, ruleId: rule.id, kind: 'PRODUCT', productId: product.id },
    });
    expect(queueItem.status).toBe('PENDING');

    const coupon = await prisma.coupon.create({
      data: { tenantId: tenant.id, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    const couponItem = await prisma.automationQueueItem.create({
      data: {
        tenantId: tenant.id,
        ruleId: rule.id,
        kind: 'COUPON',
        couponId: coupon.id,
        templateId: couponTemplate.id,
        manual: true,
      },
    });
    expect(couponItem.manual).toBe(true);
    expect(couponItem.templateId).toBe(couponTemplate.id);
    expect(couponTemplate.kind).toBe('COUPON');

    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});
