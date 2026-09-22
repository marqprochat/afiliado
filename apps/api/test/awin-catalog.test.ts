import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { searchAwinCatalog, fetchAwinCatalogByUrls } from '../src/lib/awin-catalog';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-catalog-test' } })).id;
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'p1',
      title: 'Fone Bluetooth XYZ',
      price: 99.9,
      deepLink: 'https://www.awin1.com/cread.php?x=1',
      raw: {},
    },
  });
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'p2',
      title: 'Caneca de Cerâmica',
      price: 20,
      deepLink: 'https://www.awin1.com/cread.php?x=2',
      raw: {},
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('searchAwinCatalog', () => {
  it('busca por palavra-chave no título (case-insensitive)', async () => {
    const db = forTenant(tenantId);
    const found = await searchAwinCatalog(db, 'bluetooth', 20);
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('Fone Bluetooth XYZ');
    expect(found[0]!.source).toBe('AWIN');
  });

  it('não retorna nada para outro tenant', async () => {
    const other = (await prisma.tenant.create({ data: { name: 'awin-catalog-other' } })).id;
    const db = forTenant(other);
    expect(await searchAwinCatalog(db, 'bluetooth', 20)).toEqual([]);
    await prisma.tenant.deleteMany({ where: { id: other } });
  });
});

describe('fetchAwinCatalogByUrls', () => {
  it('resolve produtos por deep link exato', async () => {
    const db = forTenant(tenantId);
    const found = await fetchAwinCatalogByUrls(db, ['https://www.awin1.com/cread.php?x=1', 'https://naoexiste']);
    expect(found).toHaveLength(1);
    expect(found[0]!.externalId).toBe('p1');
  });

  it('retorna vazio para lista de urls vazia', async () => {
    const db = forTenant(tenantId);
    expect(await fetchAwinCatalogByUrls(db, [])).toEqual([]);
  });
});
