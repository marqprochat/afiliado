import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '@afilados/db';
import { getDealDetailBySlug } from '@afilados/deals';
import { fixAwinDealImages } from '../src/lib/deal-images';

const DEAD = 'https://io.convertiez.com.br/m/drogal/fralda.jpg';
const FIXED = 'https://drogal.vteximg.com.br/arquivos/ids/1/fralda.jpg';
const SHOPEE_IMG = 'https://cf.shopee.com.br/file/x.jpg';
const DEEP_LINK = 'https://www.awin1.com/pclick.php?p=1&m=68224';
let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'deal-images-test' } })).id;
  const master = await prisma.masterProduct.create({
    data: {
      tenantId,
      title: 'Fralda Pampers RN',
      cleanTitle: 'Fralda Pampers RN',
      slug: 'fralda-pampers-rn-ab12',
      imageUrl: DEAD,
      images: [DEAD],
      lowestPriceEver: 50,
      averagePrice30d: 50,
      currentBestPrice: 50,
    },
  });
  const listing = {
    tenantId,
    masterProductId: master.id,
    currentPrice: 50,
    title: 'Fralda Pampers RN',
    affiliateUrl: 'https://site.test/r/abc',
  };
  await prisma.productListing.createMany({
    data: [
      {
        ...listing,
        source: 'AWIN',
        storeName: 'Drogal',
        externalId: 'f1:1',
        originalUrl: DEEP_LINK,
        imageUrl: DEAD,
      },
      {
        ...listing,
        source: 'SHOPEE',
        storeName: 'Shopee',
        externalId: 's1',
        originalUrl: 'https://shopee.com.br/p/1',
        imageUrl: SHOPEE_IMG,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('fixAwinDealImages', () => {
  it('troca a imagem Awin fora do ar na resposta e grava na oferta e no produto', async () => {
    const db = forTenant(tenantId);
    const deal = (await getDealDetailBySlug(db, 'fralda-pampers-rn-ab12'))!;
    const calls: { imageUrl: string | null; deepLink: string }[] = [];
    const fixed = await fixAwinDealImages(db, deal, {
      resolveImage: async (input) => {
        calls.push(input);
        return { url: FIXED, status: 'resolved' };
      },
    });

    expect(calls).toEqual([{ imageUrl: DEAD, deepLink: DEEP_LINK, title: 'Fralda Pampers RN' }]);
    expect(fixed.imageUrl).toBe(FIXED);
    expect(fixed.images).toEqual([FIXED]);
    const byStore = Object.fromEntries(fixed.listings.map((l) => [l.storeName, l.imageUrl]));
    expect(byStore).toEqual({ Drogal: FIXED, Shopee: SHOPEE_IMG });

    const master = await prisma.masterProduct.findFirstOrThrow({ where: { tenantId } });
    expect(master.imageUrl).toBe(FIXED);
    expect(master.images).toEqual([FIXED]);
    const awin = await prisma.productListing.findFirstOrThrow({
      where: { tenantId, source: 'AWIN' },
    });
    expect(awin.imageUrl).toBe(FIXED);
  });

  it('imagem no ar: nada muda', async () => {
    const db = forTenant(tenantId);
    const deal = (await getDealDetailBySlug(db, 'fralda-pampers-rn-ab12'))!;
    const fixed = await fixAwinDealImages(db, deal, {
      resolveImage: async (input) => ({ url: input.imageUrl, status: 'alive' }),
    });
    expect(fixed).toEqual(deal);
  });
});
