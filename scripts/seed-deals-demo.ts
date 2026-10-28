import { prisma } from '@afilados/db';
import { forTenant } from '@afilados/db';
import { indexProductInPriceEngine } from '../apps/api/src/lib/price-engine';
import type { ProductData } from '@afilados/shared';

async function main() {
  console.log('--- Populando demonstração do PriceEngine & Deals Hub ---');

  // Encontra ou cria um tenant
  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: 'default' } });
  }

  const db = forTenant(tenant.id);

  // Amostras de produtos com o mesmo item em diferentes marketplaces (Awin, Amazon, Shopee, Mercado Livre)
  const sampleProducts: ProductData[] = [
    // 1. iPhone 15 na Amazon (preço mais alto inicialmente)
    {
      source: 'AMAZON',
      externalId: 'B0CHX1W1XY',
      title: 'Apple iPhone 15 128 GB Preto Original',
      price: 4599.0,
      originalPrice: 5299.0,
      discountPct: 13,
      images: [
        'https://m.media-amazon.com/images/I/71657TiFeHL._AC_SL1500_.jpg',
      ],
      shipping: 'FREE',
      originalUrl: 'https://www.amazon.com.br/dp/B0CHX1W1XY',
      shopName: 'Amazon Oficial',
      raw: { ean: '195949038234' },
    },
    // 2. O MESMO iPhone 15 via Awin (Casas Bahia) com preço menor (ganha Buy Box!)
    {
      source: 'AWIN',
      externalId: 'cb-iphone15-128gb',
      title: 'Smartphone Apple iPhone 15 128GB Preto 5G Tela 6.1 Câm. 48MP',
      price: 4399.0,
      originalPrice: 5299.0,
      discountPct: 17,
      images: [
        'https://m.media-amazon.com/images/I/71657TiFeHL._AC_SL1500_.jpg',
      ],
      shipping: 'FREE',
      originalUrl: 'https://www.awin1.com/cread.php?awinmid=123&awinaffid=456&ued=https://casasbahia.com.br',
      shopName: 'Casas Bahia (Awin)',
      raw: { ean: '195949038234' },
    },
    // 3. Air Fryer Philips Walita no Mercado Livre
    {
      source: 'MERCADOLIVRE',
      externalId: 'MLB-401923812',
      title: 'Fritadeira Sem Óleo Air Fryer Philips Walita Série 3000 4.1L Preta 110V',
      price: 369.9,
      originalPrice: 499.9,
      discountPct: 26,
      images: [
        'https://http2.mlstatic.com/D_NQ_NP_2X_892842-MLB72983792374_112023-F.webp',
      ],
      shipping: 'FREE',
      originalUrl: 'https://produto.mercadolivre.com.br/MLB-401923812',
      shopName: 'Loja Oficial Philips',
      raw: {},
    },
    // 4. A MESMA Air Fryer na Shopee com outro título ligeiramente diferente
    {
      source: 'SHOPEE',
      externalId: 'sp-airfryer-walita',
      title: 'Airfryer Philips Walita 4.1 Litros Serie 3000 Preto',
      price: 349.9,
      originalPrice: 479.9,
      discountPct: 27,
      images: [
        'https://http2.mlstatic.com/D_NQ_NP_2X_892842-MLB72983792374_112023-F.webp',
      ],
      shipping: 'FREE',
      originalUrl: 'https://shopee.com.br/product/123/456',
      shopName: 'Shopee Eletro',
      raw: {},
    },
  ];

  for (const prod of sampleProducts) {
    const res = await indexProductInPriceEngine(db, tenant.id, prod);
    console.log(
      `Indexado: "${prod.title}" -> Master: ${res.masterProductId} (Novo: ${res.isNewMaster})`,
    );
  }

  console.log('Demonstração finalizada com sucesso!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
