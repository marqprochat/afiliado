const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  try {
    const products = await p.product.count();
    const awin = await p.awinCatalogProduct.count();
    const master = await p.masterProduct.count();
    const listings = await p.productListing.count();
    const tenants = await p.tenant.findMany({ select: { id: true, name: true } });
    console.log(JSON.stringify({ products, awin, master, listings, tenants }, null, 2));
  } catch (err) {
    console.error('Erro:', err.message);
  } finally {
    await p.$disconnect();
  }
}

run();
