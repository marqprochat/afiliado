import { prisma } from '@afilados/db';

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log('Tenants:', tenants);

  const productCount = await prisma.product.count();
  console.log('Total Products na tabela Product:', productCount);

  const awinCount = await prisma.awinCatalogProduct.count();
  console.log('Total AwinCatalogProducts:', awinCount);

  const masterCount = await prisma.masterProduct.count();
  console.log('Total MasterProducts:', masterCount);

  const listingsCount = await prisma.productListing.count();
  console.log('Total ProductListings:', listingsCount);
}

main().catch(console.error).finally(() => prisma.$disconnect());
