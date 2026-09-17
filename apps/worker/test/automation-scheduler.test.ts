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
    // item inelegível é removido da fila (não fica travando o topo indefinidamente)
    expect(queueItem.status).toBe('REMOVED');
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('SKIPPED');
  });

  it('pula item manual inelegível e despacha o próximo elegível na mesma rodada', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r2b',
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
    const badProduct = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Importando…',
        price: 0,
        images: [],
        originalUrl: 'https://shopee.com.br/p/ruim',
        raw: { pendingEnrich: true },
      },
    });
    const goodProduct = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Fone Bom',
        price: 50,
        images: ['https://x/2.png'],
        originalUrl: 'https://shopee.com.br/p/bom',
        raw: {},
      },
    });
    const firstItem = await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: badProduct.id, manual: true },
    });
    // garante que o segundo item é "mais novo" (addedAt posterior) e ainda assim é escolhido
    await new Promise((r) => setTimeout(r, 5));
    const secondItem = await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: goodProduct.id, manual: true },
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

    expect(enqueued.length).toBe(1);

    const first = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: firstItem.id } });
    expect(first.status).toBe('REMOVED');
    const second = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: secondItem.id } });
    expect(second.status).toBe('DISPATCHED');

    const logs = await prisma.automationLog.findMany({ where: { ruleId: rule.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['SKIPPED', 'DISPATCHED']);
  });

  it('ignora tick reentrante enquanto o anterior ainda está em andamento', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r-reentrancy',
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
        title: 'Fone Reentrância',
        price: 50,
        images: ['https://x/3.png'],
        originalUrl: 'https://shopee.com.br/p/reentrancia',
        raw: {},
      },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });

    const enqueued: string[] = [];
    let releaseFirstTick!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirstTick = resolve;
    });
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        // segura o primeiro tick "em voo" até que o teste libere, simulando uma
        // busca lenta na Shopee que ultrapassa o intervalo do setInterval.
        await gate;
        enqueued.push(batchItemId);
      },
      discover: async () => {},
    });
    await scheduler.reload();

    const firstTick = scheduler.tick();
    // dá tempo do primeiro tick marcar `ticking = true` antes de tentarmos o segundo
    await new Promise((r) => setTimeout(r, 10));
    expect(scheduler.isTicking()).toBe(true);

    const secondTick = scheduler.tick();
    await secondTick;
    expect(scheduler.isTicking()).toBe(true); // segundo tick foi no-op; o primeiro ainda está em andamento

    releaseFirstTick();
    await firstTick;

    expect(enqueued.length).toBe(1); // apenas o primeiro tick despachou; o segundo foi ignorado
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
