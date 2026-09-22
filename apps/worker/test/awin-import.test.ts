import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { importAwinCatalog } from '../src/processors/awin-import';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-import-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({ publisherId: 'pub1', datafeedApiKey: 'key1', feedIds: ['f1', 'f2'] }),
    },
  });
  // Produto que já existia no cache e NÃO vai aparecer na nova rodada do feed f1 — deve ser podado.
  await prisma.awinCatalogProduct.create({
    data: {
      tenantId,
      feedId: 'f1',
      externalId: 'stale-1',
      title: 'Produto Antigo',
      price: 1,
      deepLink: 'https://www.awin1.com/cread.php?x=stale',
      raw: {},
      lastImportedAt: new Date('2020-01-01'),
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('importAwinCatalog', () => {
  it('faz upsert dos produtos do feed e remove os que saíram (poda por feed)', async () => {
    const deps = {
      listDatafeeds: async () => [
        { advertiserId: '1', advertiserName: 'Loja 1', feedId: 'f1', feedName: 'Feed 1', url: 'https://x/f1' },
        { advertiserId: '2', advertiserName: 'Loja 2', feedId: 'f2', feedName: 'Feed 2', url: 'https://x/f2' },
      ],
      downloadFeed: async (url: string) =>
        url === 'https://x/f1'
          ? [
              {
                aw_product_id: 'p1',
                aw_deep_link: 'https://www.awin1.com/cread.php?x=p1',
                product_name: 'Produto Novo',
                search_price: '50.00',
              },
            ]
          : [],
    };

    const results = await importAwinCatalog(deps, tenantId);
    expect(results).toEqual([
      { feedId: 'f1', ok: true, imported: 1, removed: 1 },
      { feedId: 'f2', ok: true, imported: 0, removed: 0 },
    ]);

    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId } });
    expect(rows.map((r) => r.externalId)).toEqual(['p1']);
  });

  it('falha em um feedId não interrompe os demais', async () => {
    const deps = {
      listDatafeeds: async () => [
        { advertiserId: '1', advertiserName: 'Loja 1', feedId: 'f1', feedName: 'Feed 1', url: 'https://x/f1' },
      ],
      downloadFeed: async () => {
        throw new Error('feed indisponível');
      },
    };
    const results = await importAwinCatalog(deps, tenantId);
    expect(results[0]).toMatchObject({ feedId: 'f1', ok: false, error: 'feed indisponível' });
  });

  it('retorna vazio quando o tenant não tem AWIN configurada', async () => {
    const other = (await prisma.tenant.create({ data: { name: 'awin-import-none' } })).id;
    const results = await importAwinCatalog({}, other);
    expect(results).toEqual([]);
    await prisma.tenant.deleteMany({ where: { id: other } });
  });
});
