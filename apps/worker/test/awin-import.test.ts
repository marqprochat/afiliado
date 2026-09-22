import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { importAwinCatalog } from '../src/processors/awin-import';

let tenantId: string;

const feedListUrl = 'https://ui.awin.com/feedList/secret';

function activeEntry(feedId: string, url: string, format: 'Google' | 'Awin' = 'Awin') {
  return {
    advertiserId: '1',
    advertiserName: 'Loja 1',
    region: 'BR',
    membershipStatus: 'active',
    feedId,
    feedName: `Feed ${feedId}`,
    format,
    productCount: null,
    url,
  };
}

function awinRow(id: string, price: string) {
  return {
    aw_product_id: id,
    aw_deep_link: `https://www.awin1.com/cread.php?x=${id}`,
    product_name: `Produto ${id}`,
    search_price: price,
    in_stock: '1',
    is_for_sale: '1',
  };
}

async function* rowsOf(rows: Record<string, string>[]) {
  for (const r of rows) yield r;
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-import-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['f1', 'f2'] }),
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
      listDatafeeds: async () => [activeEntry('f1', 'https://x/f1'), activeEntry('f2', 'https://x/f2')],
      downloadFeed: async (url: string) =>
        url === 'https://x/f1' ? rowsOf([awinRow('p1', '50.00')]) : rowsOf([]),
    };

    const results = await importAwinCatalog(deps, tenantId);
    expect(results).toEqual([
      { feedId: 'f1', ok: true, imported: 1, removed: 1 },
      { feedId: 'f2', ok: true, imported: 0, removed: 0 },
    ]);

    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId } });
    expect(rows.map((r) => r.externalId)).toEqual(['p1']);
  });

  it('faz batching acima de 500 linhas (1200 linhas → 1200 no banco)', async () => {
    const tenant2 = (await prisma.tenant.create({ data: { name: 'awin-import-batch' } })).id;
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: tenant2,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['fb'] }),
      },
    });

    const generated = Array.from({ length: 1200 }, (_, i) => awinRow(`p${i}`, '10.00'));

    const deps = {
      listDatafeeds: async () => [activeEntry('fb', 'https://x/fb')],
      downloadFeed: async () => rowsOf(generated),
    };

    const results = await importAwinCatalog(deps, tenant2);
    expect(results).toEqual([{ feedId: 'fb', ok: true, imported: 1200, removed: 0 }]);

    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId: tenant2 } });
    expect(rows.length).toBe(1200);

    await prisma.tenant.deleteMany({ where: { id: tenant2 } });
  });

  it('deduplica externalId repetido dentro do mesmo lote (último valor vence)', async () => {
    const tenant2 = (await prisma.tenant.create({ data: { name: 'awin-import-dedupe' } })).id;
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: tenant2,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['fd'] }),
      },
    });

    const rows = [awinRow('p0', '10.00'), awinRow('p1', '10.00'), awinRow('p0', '99.00')];

    const deps = {
      listDatafeeds: async () => [activeEntry('fd', 'https://x/fd')],
      downloadFeed: async () => rowsOf(rows),
    };

    const results = await importAwinCatalog(deps, tenant2);
    expect(results).toEqual([{ feedId: 'fd', ok: true, imported: 2, removed: 0 }]);

    const saved = await prisma.awinCatalogProduct.findMany({ where: { tenantId: tenant2 } });
    expect(saved.length).toBe(2);
    const p0 = saved.find((r) => r.externalId === 'p0')!;
    expect(Number(p0.price)).toBe(99);

    await prisma.tenant.deleteMany({ where: { id: tenant2 } });
  });

  it('falha em um feedId não interrompe os demais', async () => {
    const deps = {
      listDatafeeds: async () => [activeEntry('f1', 'https://x/f1')],
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

  it('não poda o catálogo existente quando o feed retorna 0 produtos válidos', async () => {
    const tenant2 = (await prisma.tenant.create({ data: { name: 'awin-import-empty-feed' } })).id;
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: tenant2,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['f1'] }),
      },
    });
    await prisma.awinCatalogProduct.create({
      data: {
        tenantId: tenant2,
        feedId: 'f1',
        externalId: 'existing-1',
        title: 'Produto Existente',
        price: 10,
        deepLink: 'https://www.awin1.com/cread.php?x=existing',
        raw: {},
        lastImportedAt: new Date('2020-01-01'),
      },
    });

    const deps = {
      listDatafeeds: async () => [activeEntry('f1', 'https://x/f1')],
      downloadFeed: async () => rowsOf([]),
    };

    const results = await importAwinCatalog(deps, tenant2);
    expect(results).toEqual([{ feedId: 'f1', ok: true, imported: 0, removed: 0 }]);

    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId: tenant2 } });
    expect(rows.map((r) => r.externalId)).toEqual(['existing-1']);

    await prisma.tenant.deleteMany({ where: { id: tenant2 } });
  });

  it('link da lista de feeds inválido gera um resultado de erro por feed selecionado, sem derrubar o job', async () => {
    const tenant2 = (await prisma.tenant.create({ data: { name: 'awin-import-badlink' } })).id;
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: tenant2,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['f1', 'f2'] }),
      },
    });
    const deps = {
      listDatafeeds: async () => {
        throw new Error('Link da lista de feeds da Awin inválido ou não autorizado');
      },
    };
    const results = await importAwinCatalog(deps, tenant2);
    expect(results).toEqual([
      { feedId: 'f1', ok: false, imported: 0, removed: 0, error: 'Link da lista de feeds da Awin inválido ou não autorizado' },
      { feedId: 'f2', ok: false, imported: 0, removed: 0, error: 'Link da lista de feeds da Awin inválido ou não autorizado' },
    ]);
    await prisma.tenant.deleteMany({ where: { id: tenant2 } });
  });

  it('feed não selecionado (fora de creds.feedIds) não é importado, mesmo que esteja ativo na conta', async () => {
    const tenant2 = (await prisma.tenant.create({ data: { name: 'awin-import-unselected' } })).id;
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: tenant2,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({ feedListUrl, feedIds: ['f1'] }),
      },
    });
    const deps = {
      listDatafeeds: async () => [activeEntry('f1', 'https://x/f1'), activeEntry('fnotselected', 'https://x/other')],
      downloadFeed: async (url: string) =>
        url === 'https://x/f1' ? rowsOf([awinRow('p1', '10.00')]) : rowsOf([awinRow('pOther', '10.00')]),
    };
    const results = await importAwinCatalog(deps, tenant2);
    expect(results).toEqual([{ feedId: 'f1', ok: true, imported: 1, removed: 0 }]);
    const rows = await prisma.awinCatalogProduct.findMany({ where: { tenantId: tenant2 } });
    expect(rows.map((r) => r.externalId)).toEqual(['p1']);
    await prisma.tenant.deleteMany({ where: { id: tenant2 } });
  });
});
