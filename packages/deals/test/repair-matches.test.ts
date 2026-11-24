import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { repairDealMatches } from '../src/index';

let tenantId: string;
let masterA: string;
let masterB: string;

async function master(title: string, price: number) {
  return (
    await prisma.masterProduct.create({
      data: {
        tenantId,
        title,
        cleanTitle: title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
        lowestPriceEver: price,
        currentBestPrice: price,
      },
    })
  ).id;
}

async function listing(masterProductId: string, externalId: string, title: string, prices: number[]) {
  return prisma.productListing.create({
    data: {
      tenantId,
      masterProductId,
      source: 'AMAZON',
      storeName: 'Amazon Brasil',
      externalId,
      title,
      originalUrl: `https://www.amazon.com.br/dp/${externalId}`,
      currentPrice: prices[prices.length - 1]!,
      history: { create: prices.map((price) => ({ price })) },
    },
  });
}

const listingOf = (externalId: string) =>
  prisma.productListing.findFirstOrThrow({ where: { tenantId, externalId } });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'deals-repair' } })).id;
  masterA = await master('Apple iPhone 17 Pro 256 GB - azul intenso', 3000);
  masterB = await master('Apple iPhone 17 Pro 512 GB - prata', 10800);
  await listing(masterA, 'L1', 'Apple iPhone 17 Pro 256 GB - azul intenso', [9200, 9000]);
  await listing(masterA, 'L2', 'iPhone 17 Pro Apple 256GB Prata', [8800]);
  await listing(masterA, 'L3', 'Apple iPhone 17 256 GB - azul', [5500, 5000]);
  await listing(masterA, 'L4', 'Apple iPhone 17 Pro 512 GB - azul intenso', [10500]);
  await listing(masterA, 'L5', 'Apple iPhone 17 Pro 256 GB - azul intenso', [3000]);
  await listing(masterB, 'L6', 'Apple iPhone 17 Pro 512 GB - prata', [10800]);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('repairDealMatches', () => {
  it('dry-run lista as listagens incompatíveis sem gravar nada', async () => {
    const report = await repairDealMatches(forTenant(tenantId), tenantId, { apply: false });
    expect(report.applied).toBe(false);
    expect(report.mastersScanned).toBe(1);
    expect(report.mastersAffected).toBe(1);
    expect(report.moves.map((m) => m.externalId).sort()).toEqual(['L3', 'L4', 'L5']);
    const toB = report.moves.find((m) => m.externalId === 'L4');
    expect(toB?.toMasterId).toBe(masterB);
    expect(report.newMasters).toBe(2);
    expect((await listingOf('L3')).masterProductId).toBe(masterA);
  });

  it('apply move as listagens, preserva o histórico e recalcula os produtos', async () => {
    const report = await repairDealMatches(forTenant(tenantId), tenantId, { apply: true });
    expect(report.applied).toBe(true);
    expect(report.moves).toHaveLength(3);

    const l3 = await listingOf('L3');
    expect(l3.masterProductId).not.toBe(masterA);
    expect(l3.masterProductId).not.toBe(masterB);
    const h3 = await prisma.priceHistory.findMany({ where: { listingId: l3.id } });
    expect(h3.map((h) => Number(h.price)).sort()).toEqual([5000, 5500]);
    const newMaster = await prisma.masterProduct.findUniqueOrThrow({
      where: { id: l3.masterProductId },
    });
    expect(newMaster.title).toBe('Apple iPhone 17 256 GB - azul');
    expect(Number(newMaster.currentBestPrice)).toBe(5000);
    expect(Number(newMaster.lowestPriceEver)).toBe(5000);

    expect((await listingOf('L4')).masterProductId).toBe(masterB);
    const l5 = await listingOf('L5');
    expect([masterA, masterB]).not.toContain(l5.masterProductId);

    const a = await prisma.masterProduct.findUniqueOrThrow({ where: { id: masterA } });
    expect(a.listingsCount).toBe(2);
    expect(Number(a.currentBestPrice)).toBe(8800);
    expect(Number(a.lowestPriceEver)).toBe(8800);
    const b = await prisma.masterProduct.findUniqueOrThrow({ where: { id: masterB } });
    expect(b.listingsCount).toBe(2);
    expect(Number(b.currentBestPrice)).toBe(10500);
  });

  it('rodar de novo não move mais nada', async () => {
    const report = await repairDealMatches(forTenant(tenantId), tenantId, { apply: true });
    expect(report.moves).toHaveLength(0);
  });
});
