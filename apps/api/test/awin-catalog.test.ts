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

  it('filtra por nome da loja (advertiserName) quando informado', async () => {
    await prisma.awinCatalogProduct.create({
      data: {
        tenantId,
        feedId: 'f2',
        advertiserName: 'Drogal BR',
        externalId: 'p3',
        title: 'Fralda Pampers M',
        price: 59.9,
        deepLink: 'https://www.awin1.com/cread.php?x=3',
        raw: {},
      },
    });
    await prisma.awinCatalogProduct.create({
      data: {
        tenantId,
        feedId: 'f3',
        advertiserName: 'Petz BR',
        externalId: 'p4',
        title: 'Fralda Pet Descartável',
        price: 39.9,
        deepLink: 'https://www.awin1.com/cread.php?x=4',
        raw: {},
      },
    });
    const db = forTenant(tenantId);
    const found = await searchAwinCatalog(db, 'fralda', 20, 'Drogal');
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('Fralda Pampers M');
    // O nome da loja vai como shopName (ranking por EPC e filtro da lista na web).
    expect(found[0]!.shopName).toBe('Drogal BR');
  });

  it('não retorna nada para outro tenant', async () => {
    const other = (await prisma.tenant.create({ data: { name: 'awin-catalog-other' } })).id;
    const db = forTenant(other);
    expect(await searchAwinCatalog(db, 'bluetooth', 20)).toEqual([]);
    await prisma.tenant.deleteMany({ where: { id: other } });
  });
});

describe('searchAwinCatalog: imagem quebrada', () => {
  it('troca a imagem fora do ar pela substituta e grava no catálogo', async () => {
    const dead = 'https://io.convertiez.com.br/m/drogal/pomada.jpg';
    const alive = 'https://cdn.loja.com/sabonete.jpg';
    const fixed = 'https://drogal.vteximg.com.br/arquivos/ids/1/pomada.jpg';
    const common = { tenantId, feedId: 'f9', price: 10, raw: {} };
    await prisma.awinCatalogProduct.createMany({
      data: [
        {
          ...common,
          externalId: 'img1',
          title: 'Pomada Zeta',
          imageUrl: dead,
          deepLink: 'https://www.awin1.com/pclick.php?p=1',
        },
        {
          ...common,
          externalId: 'img2',
          title: 'Sabonete Zeta',
          imageUrl: alive,
          deepLink: 'https://www.awin1.com/pclick.php?p=2',
        },
      ],
    });
    const calls: string[] = [];
    const resolveImage = async (input: { imageUrl: string | null; deepLink: string }) => {
      calls.push(input.imageUrl ?? '');
      return input.imageUrl === dead
        ? { url: fixed, status: 'resolved' as const }
        : { url: input.imageUrl, status: 'alive' as const };
    };
    const db = forTenant(tenantId);
    const found = await searchAwinCatalog(db, 'zeta', 20, undefined, { resolveImage });
    const byTitle = Object.fromEntries(found.map((p) => [p.title, p.images[0]]));
    expect(byTitle).toEqual({ 'Pomada Zeta': fixed, 'Sabonete Zeta': alive });

    const saved = await prisma.awinCatalogProduct.findFirstOrThrow({
      where: { tenantId, externalId: 'img1' },
    });
    expect(saved.imageUrl).toBe(fixed);
    expect(saved.imageOriginalUrl).toBe(dead);

    // Segunda busca: a já resolvida não é verificada de novo.
    calls.length = 0;
    await searchAwinCatalog(db, 'zeta', 20, undefined, { resolveImage });
    expect(calls).toEqual([alive]);
  });
});

describe('fetchAwinCatalogByUrls', () => {
  it('resolve produtos por deep link exato', async () => {
    const db = forTenant(tenantId);
    const found = await fetchAwinCatalogByUrls(db, [
      'https://www.awin1.com/cread.php?x=1',
      'https://naoexiste',
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.externalId).toBe('f1:p1');
  });

  it('retorna vazio para lista de urls vazia', async () => {
    const db = forTenant(tenantId);
    expect(await fetchAwinCatalogByUrls(db, [])).toEqual([]);
  });
});
