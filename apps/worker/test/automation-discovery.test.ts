import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { discoverForRule } from '../src/automation/discovery';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'automation-discovery-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('discoverForRule (Shopee)', () => {
  it('cria Product + AutomationQueueItem para resultados elegíveis e filtra bloqueados', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: ['usado'],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't', body: 'x' } })).id,
      },
    });

    const searchResults = [
      {
        source: 'SHOPEE' as const,
        externalId: '1',
        title: 'Fone Bluetooth Novo',
        price: 50,
        images: ['https://x/1.png'],
        shipping: 'FREE' as const,
        originalUrl: 'https://shopee.com.br/p/1',
        raw: {},
      },
      {
        source: 'SHOPEE' as const,
        externalId: '2',
        title: 'Fone usado bom estado',
        price: 20,
        images: ['https://x/2.png'],
        shipping: 'FREE' as const,
        originalUrl: 'https://shopee.com.br/p/2',
        raw: {},
      },
    ];

    await discoverForRule(rule, { searchShopee: async () => searchResults });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(1);
    expect(items[0]!.product!.title).toBe('Fone Bluetooth Novo');

    const discoveredLogs = await prisma.automationLog.findMany({
      where: { ruleId: rule.id, action: 'DISCOVERED' },
    });
    expect(discoveredLogs.length).toBe(1);
    expect(discoveredLogs[0]!.productId).toBe(items[0]!.product!.id);
    expect(discoveredLogs[0]!.marketplace).toBe('SHOPEE');
  });

  it('não duplica AutomationQueueItem se o produto já estiver na fila da regra', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule-2',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's2' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't2', body: 'x' } })).id,
      },
    });
    const sameResult = {
      source: 'SHOPEE' as const,
      externalId: '99',
      title: 'Fone repetido',
      price: 30,
      images: ['https://x/9.png'],
      shipping: 'FREE' as const,
      originalUrl: 'https://shopee.com.br/p/99',
      raw: {},
    };
    await discoverForRule(rule, { searchShopee: async () => [sameResult] });
    await discoverForRule(rule, { searchShopee: async () => [sameResult] });

    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(items.length).toBe(1);
  });

  it('não propaga exceção quando search falha, e registra AutomationLog de ERROR', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule-3',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's3' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't3', body: 'x' } })).id,
      },
    });

    await expect(
      discoverForRule(rule, {
        searchShopee: async () => {
          throw new Error('falha de rede na Shopee');
        },
      }),
    ).resolves.not.toThrow();

    const logs = await prisma.automationLog.findMany({ where: { ruleId: rule.id, action: 'ERROR' } });
    expect(logs.length).toBe(1);
    expect(logs[0]!.reason).toBe('falha de rede na Shopee');
    expect(logs[0]!.marketplace).toBe('SHOPEE');
  });
});

describe('discoverForRule (Mercado Livre / Amazon / Magalu)', () => {
  it('descobre produto do Mercado Livre quando discoverByKeyword é injetado (bypassa o carregamento de sessão)', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-ml',
        marketplaces: ['MERCADOLIVRE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 'sml' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 'tml', body: 'x' } })).id,
      },
    });

    const foundUrl = 'https://produto.mercadolivre.com.br/MLB-9999999999-fone-bluetooth';
    const enriched = {
      source: 'MERCADOLIVRE' as const,
      externalId: 'MLB9999999999',
      title: 'Fone Bluetooth ML',
      price: 80,
      images: ['https://x/ml.png'],
      shipping: 'FREE' as const,
      originalUrl: foundUrl,
      raw: {},
    };

    await discoverForRule(rule, {
      pickMarketplace: () => 'MERCADOLIVRE',
      discoverByKeyword: { MERCADOLIVRE: async () => [foundUrl] },
      fetchByUrls: { MERCADOLIVRE: async () => [enriched] },
    });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(1);
    expect(items[0]!.product!.source).toBe('MERCADOLIVRE');
  });

  it('loga ERROR e não derruba a regra quando o scraper falha', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-amazon-falha',
        marketplaces: ['AMAZON'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 'sam' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 'tam', body: 'x' } })).id,
      },
    });

    await discoverForRule(rule, {
      pickMarketplace: () => 'AMAZON',
      discoverByKeyword: {
        AMAZON: async () => {
          throw new Error('timeout ao buscar amazon.com.br');
        },
      },
    });

    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('ERROR');
    expect(log.marketplace).toBe('AMAZON');
    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(items.length).toBe(0);
  });

  it('loga ERROR (não apenas silêncio) quando a busca do ML retorna vazio — sinal de bloqueio anti-bot', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-ml-vazio-bloqueado',
        marketplaces: ['MERCADOLIVRE'],
        keywords: ['fone-sessao-bloqueada'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 'sml3' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 'tml3', body: 'x' } })).id,
      },
    });

    // Simula sessão bloqueada/expirada: o discoverByKeyword injetado (equivalente ao fluxo
    // autenticado real) retorna [] em vez de lançar — uma página de desafio anti-bot parseia
    // como HTML válido, só sem links de produto reconhecíveis.
    await discoverForRule(rule, {
      pickMarketplace: () => 'MERCADOLIVRE',
      discoverByKeyword: { MERCADOLIVRE: async () => [] },
    });

    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('ERROR');
    expect(log.reason).toMatch(/sessão|bloqueio/);
    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(items.length).toBe(0);
  });
});
