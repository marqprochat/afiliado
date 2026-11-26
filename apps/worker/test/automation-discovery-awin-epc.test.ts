import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { discoverForRule } from '../src/automation/discovery';

let tenantId: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'automation-awin-epc' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: 'x' } })).id;
  const row = (advertiserId: string, externalId: string) => ({
    tenantId,
    feedId: `feed-${advertiserId}`,
    advertiserId,
    advertiserName: `Loja ${advertiserId}`,
    externalId,
    title: `Protetor solar ${externalId}`,
    price: 50,
    deepLink: `https://www.awin1.com/cread.php?x=${externalId}`,
    raw: {},
  });
  // Ordem de inserção: loja sem indicador, loja fraca, loja forte.
  await prisma.awinCatalogProduct.createMany({
    data: [row('30', 'sem-epc'), row('10', 'fraca'), row('20', 'forte')],
  });
  await prisma.awinProgrammeStats.createMany({
    data: [
      {
        tenantId,
        advertiserId: '10',
        name: 'Loja 10',
        epc: 0.1,
        score: 0.08,
        fetchedAt: new Date(),
      },
      {
        tenantId,
        advertiserId: '20',
        name: 'Loja 20',
        epc: 0.9,
        score: 0.72,
        fetchedAt: new Date(),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const makeRule = (over: { awinPrioritizeEpc?: boolean; awinMinEpc?: number | null }) =>
  prisma.automationRule.create({
    data: {
      tenantId,
      name: `awin-epc-${Math.random()}`,
      marketplaces: ['AWIN'],
      keywords: ['protetor'],
      blockedKeywords: [],
      maxOffersPerDay: 10,
      sessionId,
      groupJids: ['g@g.us'],
      templateId,
      ...over,
    },
  });

const queuedTitles = async (ruleId: string) =>
  (
    await prisma.automationQueueItem.findMany({
      where: { ruleId },
      orderBy: { position: 'asc' },
      include: { product: true },
    })
  ).map((i) => i.product!.title.replace('Protetor solar ', ''));

describe('discoverForRule (Awin) com EPC', () => {
  it('"Priorizar lojas com melhor EPC" ordena pelo score da loja (sem indicador no fim)', async () => {
    const rule = await makeRule({ awinPrioritizeEpc: true });
    await discoverForRule(rule);
    expect(await queuedTitles(rule.id)).toEqual(['forte', 'fraca', 'sem-epc']);
  });

  it('"EPC mínimo" descarta lojas abaixo do mínimo e as sem EPC conhecido', async () => {
    const rule = await makeRule({ awinMinEpc: 0.5 });
    await discoverForRule(rule);
    expect(await queuedTitles(rule.id)).toEqual(['forte']);
  });

  it('sem as opções mantém o comportamento atual (todas as lojas)', async () => {
    const rule = await makeRule({});
    await discoverForRule(rule);
    expect((await queuedTitles(rule.id)).sort()).toEqual(['forte', 'fraca', 'sem-epc']);
  });
});
