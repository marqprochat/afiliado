import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import { AutomationScheduler } from '../src/automation/scheduler';

let tenantId: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'automation-scheduler-test' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's', status: 'CONNECTED' } })).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: '{titulo} {link}' } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('AutomationScheduler', () => {
  it('despacha item manual antes de descobrir automaticamente', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r1',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        intervalMin: 5,
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Fone Manual',
        price: 50,
        images: ['https://x/1.png'],
        originalUrl: 'https://shopee.com.br/p/manual',
        raw: {},
      },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });

    const enqueued: string[] = [];
    const discoverCalls: string[] = [];
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        enqueued.push(batchItemId);
      },
      discover: async (r) => {
        discoverCalls.push(r.id);
      },
    });
    await scheduler.reload();
    expect(scheduler.ruleCount()).toBe(1);
    await scheduler.tick();

    expect(enqueued.length).toBe(1);
    expect(discoverCalls.length).toBe(0); // item manual pulou a descoberta
    const queueItem = await prisma.automationQueueItem.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(queueItem.status).toBe('DISPATCHED');
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('DISPATCHED');
  });

  it('pula produto inelegível (pendingEnrich) e loga SKIPPED sem despachar', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r2',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        intervalMin: 5,
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Importando…',
        price: 0,
        images: [],
        originalUrl: 'https://shopee.com.br/p/pendente',
        raw: { pendingEnrich: true },
      },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });

    const enqueued: string[] = [];
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        enqueued.push(batchItemId);
      },
      discover: async () => {},
    });
    await scheduler.reload();
    await scheduler.tick();

    expect(enqueued.length).toBe(0);
    const queueItem = await prisma.automationQueueItem.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(queueItem.status).toBe('PENDING');
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('SKIPPED');
  });

  it('não recarrega regra desabilitada', async () => {
    await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r3-desabilitada',
        enabled: false,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const scheduler = new AutomationScheduler({ enqueue: vi.fn(), discover: async () => {} });
    await scheduler.reload();
    expect(scheduler.ruleNames()).not.toContain('r3-desabilitada');
  });
});
