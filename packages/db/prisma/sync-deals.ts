import { prisma } from '../src/index';
import { normalizeProductTitle } from '@afilados/core';

async function main() {
  console.log('--- Sincronizando Produtos e Catálogo Awin com o PriceEngine ---');

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.log('Nenhum tenant encontrado no banco.');
    return;
  }
  const tenantId = tenant.id;

  // 1. Verifica quantos produtos existem em Product e AwinCatalogProduct
  const totalProducts = await prisma.product.count({ where: { tenantId } });
  const totalAwin = await prisma.awinCatalogProduct.count({ where: { tenantId } });
  console.log(`Encontrados: ${totalProducts} produtos na vitrine e ${totalAwin} no catálogo da Awin.`);

  let syncedCount = 0;

  // 2. Sincroniza produtos existentes da tabela Product
  const existingProducts = await prisma.product.findMany({
    where: { tenantId },
    take: 500,
  });

  for (const p of existingProducts) {
    const norm = normalizeProductTitle(p.title);
    const priceNum = Number(p.price);
    if (!priceNum || priceNum <= 0) continue;

    // Procura se já existe MasterProduct por cleanTitle ou slug
    let master = await prisma.masterProduct.findFirst({
      where: {
        tenantId,
        OR: [
          { cleanTitle: norm.cleanTitle },
          { slug: { startsWith: norm.slug } },
        ],
      },
    });

    if (!master) {
      const slug = `${norm.slug}-${Math.random().toString(36).substring(2, 6)}`;
      master = await prisma.masterProduct.create({
        data: {
          tenantId,
          title: norm.cleanTitle,
          cleanTitle: norm.cleanTitle,
          slug,
          brand: norm.brand ?? null,
          category: 'Ofertas em Destaque',
          imageUrl: p.images[0] ?? null,
          images: p.images,
          lowestPriceEver: p.price,
          averagePrice30d: p.price,
          currentBestPrice: p.price,
          listingsCount: 1,
        },
      });
    }

    // Cria ou atualiza listing
    const extId = p.externalId || p.id;
    await prisma.productListing.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId,
          source: p.source,
          externalId: extId,
        },
      },
      update: {
        masterProductId: master.id,
        currentPrice: p.price,
        originalPrice: p.originalPrice,
        inStock: true,
      },
      create: {
        tenantId,
        masterProductId: master.id,
        source: p.source,
        storeName: p.shopName || p.source,
        externalId: extId,
        title: p.title,
        originalUrl: p.originalUrl,
        affiliateUrl: p.originalUrl,
        currentPrice: p.price,
        originalPrice: p.originalPrice,
        discountPct: p.discountPct,
        imageUrl: p.images[0] ?? null,
        inStock: true,
      },
    });

    syncedCount++;
  }

  // 3. Sincroniza produtos do catálogo da Awin (AwinCatalogProduct)
  const awinProducts = await prisma.awinCatalogProduct.findMany({
    where: { tenantId },
    take: 500,
  });

  for (const aw of awinProducts) {
    const norm = normalizeProductTitle(aw.title);
    const priceNum = Number(aw.price);
    if (!priceNum || priceNum <= 0) continue;

    let master = await prisma.masterProduct.findFirst({
      where: {
        tenantId,
        OR: [
          { cleanTitle: norm.cleanTitle },
          { slug: { startsWith: norm.slug } },
        ],
      },
    });

    if (!master) {
      const slug = `${norm.slug}-${Math.random().toString(36).substring(2, 6)}`;
      master = await prisma.masterProduct.create({
        data: {
          tenantId,
          title: norm.cleanTitle,
          cleanTitle: norm.cleanTitle,
          slug,
          brand: norm.brand ?? null,
          category: 'Awin & Lojas Parceiras',
          imageUrl: aw.imageUrl,
          images: aw.imageUrl ? [aw.imageUrl] : [],
          lowestPriceEver: aw.price,
          averagePrice30d: aw.price,
          currentBestPrice: aw.price,
          listingsCount: 1,
        },
      });
    }

    await prisma.productListing.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId,
          source: 'AWIN',
          externalId: aw.externalId,
        },
      },
      update: {
        masterProductId: master.id,
        currentPrice: aw.price,
        originalPrice: aw.originalPrice,
        inStock: true,
      },
      create: {
        tenantId,
        masterProductId: master.id,
        source: 'AWIN',
        storeName: aw.advertiserName || 'Awin Parceiro',
        externalId: aw.externalId,
        title: aw.title,
        originalUrl: aw.deepLink,
        affiliateUrl: aw.deepLink,
        currentPrice: aw.price,
        originalPrice: aw.originalPrice,
        imageUrl: aw.imageUrl,
        inStock: true,
      },
    });

    syncedCount++;
  }

  const finalMasterCount = await prisma.masterProduct.count({ where: { tenantId } });
  console.log(`Sincronização concluída! MasterProducts criados/atualizados: ${finalMasterCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
