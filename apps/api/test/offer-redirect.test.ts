import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, makePublicSiteOwner } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let restoreOwner: () => Promise<void>;
let awinListingId: string;
let shopeeListingId: string;
let otherListingId: string;

const AWIN_URL =
  'https://www.awin1.com/cread.php?awinmid=9999&awinaffid=12345&platform=dl&ued=https%3A%2F%2Floja.com%2Fp&clickref=aff1';

async function listing(
  tenantId: string,
  source: 'AWIN' | 'SHOPEE',
  affiliateUrl: string,
  ext: string,
) {
  const master = await prisma.masterProduct.create({
    data: {
      tenantId,
      title: `P ${ext}`,
      cleanTitle: `P ${ext}`,
      slug: `p-${ext}-${Date.now()}`,
      lowestPriceEver: 10,
      currentBestPrice: 10,
    },
  });
  return (
    await prisma.productListing.create({
      data: {
        tenantId,
        masterProductId: master.id,
        source,
        storeName: source,
        externalId: ext,
        title: `P ${ext}`,
        originalUrl: 'https://loja.com/p',
        affiliateUrl,
        currentPrice: 10,
      },
    })
  ).id;
}

beforeAll(async () => {
  owner = await createTenantWithUser('redirect-owner');
  other = await createTenantWithUser('redirect-other');
  restoreOwner = await makePublicSiteOwner(owner.userId);
  awinListingId = await listing(owner.tenantId, 'AWIN', AWIN_URL, 'awin1');
  shopeeListingId = await listing(owner.tenantId, 'SHOPEE', 'https://s.shopee.com.br/AFF', 'sh1');
  otherListingId = await listing(other.tenantId, 'SHOPEE', 'https://s.shopee.com.br/X', 'sh2');
});

afterAll(async () => {
  await restoreOwner();
  await cleanupTenant(owner.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('GET /r/:listingId', () => {
  it('Awin: grava o clique e redireciona (302) com clickref2/3, mantendo o clickref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/r/${awinListingId}?c=wAbc12&b=lote1`,
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(String(res.headers.location));
    expect(loc.searchParams.get('clickref')).toBe('aff1');
    expect(loc.searchParams.get('clickref2')).toBe('wAbc12');
    expect(loc.searchParams.get('clickref3')).toBe('lote1');
    const clicks = await prisma.offerClick.findMany({ where: { listingId: awinListingId } });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({
      tenantId: owner.tenantId,
      channelCode: 'wAbc12',
      batchId: 'lote1',
    });
  });

  it('outra loja: redireciona para o link como está; c/b inválidos são ignorados', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/r/${shopeeListingId}?c=---&b=${'x'.repeat(5)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://s.shopee.com.br/AFF');
    const click = await prisma.offerClick.findFirstOrThrow({
      where: { listingId: shopeeListingId },
    });
    expect(click.channelCode).toBeNull();
    expect(click.batchId).toBe('xxxxx');
  });

  it('listagem inexistente ou de outro tenant → 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/r/nao-existe' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/r/${otherListingId}` })).statusCode,
    ).toBe(404);
  });

  it('falha ao gravar o clique não impede o redirecionamento', async () => {
    const spy = vi.spyOn(prisma.offerClick, 'create').mockRejectedValueOnce(new Error('db fora'));
    try {
      const res = await app.inject({ method: 'GET', url: `/api/v1/r/${shopeeListingId}?c=wAbc12` });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://s.shopee.com.br/AFF');
    } finally {
      spy.mockRestore();
    }
  });
});
