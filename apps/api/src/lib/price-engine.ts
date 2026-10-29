import { createHash } from 'node:crypto';
import type { TenantClient } from '@afilados/db';
import type { ProductData } from '@afilados/shared';
import {
  normalizeProductTitle,
  findBestProductMatch,
  analyzeDealPromotion,
  type DealAnalysis,
  type MatchingCandidate,
} from '@afilados/core';

function formatStoreName(source: string, customName?: string | null): string {
  if (customName && customName.trim().length > 0) return customName.trim();
  switch (source) {
    case 'AMAZON':
      return 'Amazon Brasil';
    case 'MERCADOLIVRE':
      return 'Mercado Livre';
    case 'SHOPEE':
      return 'Shopee';
    case 'MAGALU':
      return 'Magazine Luiza';
    case 'ALIEXPRESS':
      return 'AliExpress';
    case 'AWIN':
      return 'Awin Parceiro';
    default:
      return 'Loja Parceira';
  }
}

function inferCategory(title: string): string {
  const lower = title.toLowerCase();
  if (/\b(smartphone|iphone|galaxy|celular|motorola|xiaomi)\b/i.test(lower)) return 'Celulares & Smartphones';
  if (/\b(tv|smart tv|televis[aã]o|monitor|oled|qled)\b/i.test(lower)) return 'TV & Vídeo';
  if (/\b(notebook|laptop|computador|pc|gamer|macbook|teclado|mouse)\b/i.test(lower)) return 'Informática';
  if (/\b(air fryer|fritadeira|geladeira|fog[aã]o|micro-ondas|cafeteira|liquidificador|aspirador)\b/i.test(lower)) return 'Eletrodomésticos';
  if (/\b(fone|headphone|headset|jbl|caixa de som|bluetooth|earbuds|airpods)\b/i.test(lower)) return 'Áudio & Som';
  if (/\b(playstation|ps5|ps4|xbox|nintendo|switch|game)\b/i.test(lower)) return 'Games & Consoles';
  if (/\b(relogio|smartwatch|relogio inteligente|apple watch)\b/i.test(lower)) return 'Smartwatches';
  return 'Geral & Ofertas';
}

/**
 * Registra ou atualiza um produto no PriceEngine:
 * deduplica produtos idênticos entre marketplaces, alimenta o histórico de preços
 * e dispara alertas cadastrados se o preço bateu o valor desejado.
 */
export async function indexProductInPriceEngine(
  db: TenantClient,
  tenantId: string,
  item: ProductData,
): Promise<{ masterProductId: string; isNewMaster: boolean; isPriceDrop: boolean }> {
  const norm = normalizeProductTitle(item.title);
  const externalId = item.externalId ?? createHash('sha1').update(item.originalUrl).digest('hex');
  const storeName = formatStoreName(item.source, item.shopName);

  // Extrai possível EAN de item.raw se disponível
  const rawObj = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<string, unknown>;
  const eanCandidate = (rawObj.ean ?? rawObj.gtin ?? rawObj.barcode ?? null) as string | null;
  const cleanEan = eanCandidate && String(eanCandidate).trim().length >= 8 ? String(eanCandidate).trim() : null;

  // 1. Busca por EAN exato se disponível
  let matchedMasterId: string | null = null;
  if (cleanEan) {
    const byEan = await db.masterProduct.findFirst({
      where: { ean: cleanEan },
    });
    if (byEan) {
      matchedMasterId = byEan.id;
    }
  }

  // 2. Se não achou por EAN, busca candidatos recentes por tokens ou marca
  if (!matchedMasterId) {
    const recentMasters = await db.masterProduct.findMany({
      where: norm.brand ? { brand: norm.brand } : {},
      take: 40,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        ean: true,
        brand: true,
        currentBestPrice: true,
      },
    });

    const candidates: MatchingCandidate[] = recentMasters.map((m) => ({
      id: m.id,
      title: m.title,
      ean: m.ean,
      brand: m.brand,
      currentBestPrice: Number(m.currentBestPrice),
    }));

    const match = findBestProductMatch(
      {
        title: item.title,
        ean: cleanEan,
        brand: norm.brand ?? null,
        price: item.price,
      },
      candidates,
    );

    if (match) {
      matchedMasterId = match.id;
    }
  }

  let masterId = matchedMasterId;
  let isNewMaster = false;
  let isPriceDrop = false;

  // Se não encontrou nenhum match, cria um novo MasterProduct
  if (!masterId) {
    isNewMaster = true;
    const baseSlug = norm.slug;
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const uniqueSlug = `${baseSlug}-${randomSuffix}`;
    const category = inferCategory(item.title);

    const newMaster = await db.masterProduct.create({
      data: {
        tenantId,
        title: norm.cleanTitle,
        cleanTitle: norm.cleanTitle,
        slug: uniqueSlug,
        brand: norm.brand ?? null,
        ean: cleanEan,
        category,
        imageUrl: item.images[0] ?? null,
        images: item.images,
        lowestPriceEver: item.price,
        averagePrice30d: item.price,
        currentBestPrice: item.price,
        listingsCount: 1,
      },
    });
    masterId = newMaster.id;
  }

  // 3. Atualiza ou cria a oferta da loja (ProductListing)
  const existingListing = await db.productListing.findFirst({
    where: {
      source: item.source,
      externalId,
    },
  });

  let listingId: string;
  const currentPriceNum = Number(item.price);
  const originalPriceNum = item.originalPrice ? Number(item.originalPrice) : null;

  if (existingListing) {
    listingId = existingListing.id;
    const oldPrice = Number(existingListing.currentPrice);
    if (currentPriceNum < oldPrice) {
      isPriceDrop = true;
    }

    // Se o preço alterou, grava no histórico temporal
    if (Math.abs(oldPrice - currentPriceNum) > 0.01) {
      await db.priceHistory.create({
        data: {
          listingId: existingListing.id,
          price: currentPriceNum,
          originalPrice: originalPriceNum,
        },
      });
    }

    await db.productListing.updateMany({
      where: { id: existingListing.id },
      data: {
        masterProductId: masterId,
        storeName,
        title: item.title,
        originalUrl: item.originalUrl,
        affiliateUrl: item.originalUrl,
        currentPrice: currentPriceNum,
        originalPrice: originalPriceNum,
        discountPct: item.discountPct ?? null,
        imageUrl: item.images[0] ?? existingListing.imageUrl,
        inStock: true,
        lastCheckedAt: new Date(),
      },
    });
  } else {
    // Nova listagem em loja
    const createdListing = await db.productListing.create({
      data: {
        tenantId,
        masterProductId: masterId,
        source: item.source,
        storeName,
        externalId,
        title: item.title,
        originalUrl: item.originalUrl,
        affiliateUrl: item.originalUrl,
        currentPrice: currentPriceNum,
        originalPrice: originalPriceNum,
        discountPct: item.discountPct ?? null,
        imageUrl: item.images[0] ?? null,
        inStock: true,
      },
    });
    listingId = createdListing.id;

    // Registra primeiro ponto no histórico
    await db.priceHistory.create({
      data: {
        listingId: createdListing.id,
        price: currentPriceNum,
        originalPrice: originalPriceNum,
      },
    });
  }

  // 4. Recalcula métricas do MasterProduct
  const allListings = await db.productListing.findMany({
    where: { masterProductId: masterId, inStock: true },
    select: { id: true, currentPrice: true },
  });

  const activePrices = allListings.map((l) => Number(l.currentPrice)).filter((p) => p > 0);
  const bestPrice = activePrices.length > 0 ? Math.min(...activePrices) : currentPriceNum;
  const bestListing = allListings.find((l) => Number(l.currentPrice) === bestPrice) ?? null;

  // Busca histórico consolidado para média de 30 dias
  const allListingIds = allListings.map((l) => l.id);
  const historyEntries = await db.priceHistory.findMany({
    where: { listingId: { in: allListingIds } },
    select: { price: true },
  });

  const allRecordedPrices = historyEntries.map((h) => Number(h.price));
  const avg30d = allRecordedPrices.length > 0
    ? Number((allRecordedPrices.reduce((a, b) => a + b, 0) / allRecordedPrices.length).toFixed(2))
    : bestPrice;

  const currentMaster = await db.masterProduct.findFirst({
    where: { id: masterId },
    select: { lowestPriceEver: true },
  });

  const prevLowest = currentMaster ? Number(currentMaster.lowestPriceEver) : bestPrice;
  const newLowestEver = Math.min(prevLowest, bestPrice);

  await db.masterProduct.updateMany({
    where: { id: masterId },
    data: {
      currentBestPrice: bestPrice,
      lowestPriceEver: newLowestEver,
      averagePrice30d: avg30d,
      bestListingId: bestListing ? bestListing.id : listingId,
      listingsCount: allListings.length,
      updatedAt: new Date(),
    },
  });

  // 5. Verifica e processa alertas cadastrados
  await checkAndNotifyPriceAlerts(db, masterId, bestPrice);

  return { masterProductId: masterId, isNewMaster, isPriceDrop };
}

/**
 * Garante que a vitrine de ofertas esteja populada com produtos caso
 * MasterProduct ainda esteja vazio, importando automaticamente os itens
 * existentes de Product e AwinCatalogProduct.
 */
export async function ensureDealsPopulated(db: TenantClient, tenantId: string): Promise<void> {
  const currentCount = await db.masterProduct.count();
  if (currentCount > 0) return;

  // 1. Pega produtos existentes na tabela Product
  const existingProducts = await db.product.findMany({
    take: 150,
    orderBy: { createdAt: 'desc' },
  });

  for (const p of existingProducts) {
    const priceNum = Number(p.price);
    if (!priceNum || priceNum <= 0) continue;

    const data: ProductData = {
      source: p.source,
      externalId: p.externalId ?? p.id,
      title: p.title,
      price: priceNum,
      images: p.images,
      shipping: p.shipping,
      originalUrl: p.originalUrl,
      raw: (p.raw && typeof p.raw === 'object' ? p.raw : {}) as Record<string, unknown>,
      ...(p.originalPrice ? { originalPrice: Number(p.originalPrice) } : {}),
      ...(p.discountPct !== null && p.discountPct !== undefined ? { discountPct: p.discountPct } : {}),
      ...(p.salesCount !== null && p.salesCount !== undefined ? { salesCount: p.salesCount } : {}),
      ...(p.commissionPct ? { commissionPct: Number(p.commissionPct) } : {}),
      ...(p.shopId ? { shopId: p.shopId } : {}),
      ...(p.shopName ? { shopName: p.shopName } : {}),
    };

    await indexProductInPriceEngine(db, tenantId, data).catch(() => {});
  }

  // 2. Pega produtos do catálogo Awin (AwinCatalogProduct)
  const awinItems = await db.awinCatalogProduct.findMany({
    take: 150,
    orderBy: { lastImportedAt: 'desc' },
  });

  for (const aw of awinItems) {
    const priceNum = Number(aw.price);
    if (!priceNum || priceNum <= 0) continue;

    const data: ProductData = {
      source: 'AWIN',
      externalId: aw.externalId,
      title: aw.title,
      price: priceNum,
      images: aw.imageUrl ? [aw.imageUrl] : [],
      shipping: 'UNKNOWN',
      originalUrl: aw.deepLink,
      raw: (aw.raw && typeof aw.raw === 'object' ? aw.raw : {}) as Record<string, unknown>,
      ...(aw.originalPrice ? { originalPrice: Number(aw.originalPrice) } : {}),
      ...(aw.advertiserName ? { shopName: aw.advertiserName } : {}),
    };

    await indexProductInPriceEngine(db, tenantId, data).catch(() => {});
  }
}

/**
 * Dispara alertas para usuários quando o preço atingir o alvo desejado ou sofrer queda.
 */
export async function checkAndNotifyPriceAlerts(
  db: TenantClient,
  masterProductId: string,
  currentPrice: number,
): Promise<number> {
  const pendingAlerts = await db.priceAlert.findMany({
    where: {
      masterProductId,
      triggered: false,
    },
    include: {
      masterProduct: {
        select: { title: true, slug: true },
      },
    },
  });

  let triggeredCount = 0;

  for (const alert of pendingAlerts) {
    const target = alert.targetPrice ? Number(alert.targetPrice) : null;
    const shouldTrigger =
      alert.notifyOnAnyDrop ||
      (target !== null && currentPrice <= target);

    if (shouldTrigger) {
      await db.priceAlert.updateMany({
        where: { id: alert.id },
        data: {
          triggered: true,
          triggeredAt: new Date(),
          lastNotifiedPrice: currentPrice,
        },
      });
      triggeredCount++;
    }
  }

  return triggeredCount;
}

/**
 * Consulta a vitrine de produtos canônicos com filtros avançados.
 */
export async function getDealsShowcase(
  db: TenantClient,
  options: {
    query?: string | undefined;
    category?: string | undefined;
    source?: string | undefined;
    allTimeLowOnly?: boolean | undefined;
    page?: number | undefined;
    limit?: number | undefined;
  },
) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 24));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (options.category && options.category !== 'ALL') {
    where.category = options.category;
  }

  if (options.query && options.query.trim().length > 0) {
    where.cleanTitle = { contains: options.query.trim(), mode: 'insensitive' };
  }

  const [total, items] = await Promise.all([
    db.masterProduct.count({ where }),
    db.masterProduct.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        listings: {
          where: { inStock: true },
          orderBy: { currentPrice: 'asc' },
          select: {
            id: true,
            source: true,
            storeName: true,
            currentPrice: true,
            originalPrice: true,
            discountPct: true,
            affiliateUrl: true,
            imageUrl: true,
          },
        },
      },
    }),
  ]);

  const deals = items.map((item) => {
    const currentPrice = Number(item.currentBestPrice);
    const avgPrice = item.averagePrice30d ? Number(item.averagePrice30d) : currentPrice;
    const lowestEver = Number(item.lowestPriceEver);

    const bestListing = item.listings[0] ?? null;
    const originalPrice = bestListing?.originalPrice ? Number(bestListing.originalPrice) : null;

    const dealAnalysis: DealAnalysis = analyzeDealPromotion(
      [{ price: avgPrice }, { price: lowestEver }],
      currentPrice,
      originalPrice,
    );

    return {
      id: item.id,
      title: item.title,
      cleanTitle: item.cleanTitle,
      slug: item.slug,
      brand: item.brand,
      category: item.category,
      imageUrl: item.imageUrl,
      currentBestPrice: currentPrice,
      lowestPriceEver: lowestEver,
      averagePrice30d: avgPrice,
      listingsCount: item.listingsCount,
      analysis: dealAnalysis,
      bestListing: bestListing
        ? {
            ...bestListing,
            currentPrice: Number(bestListing.currentPrice),
            originalPrice: bestListing.originalPrice ? Number(bestListing.originalPrice) : null,
          }
        : null,
      availableStores: item.listings.map((l) => ({
        storeName: l.storeName,
        source: l.source,
        price: Number(l.currentPrice),
        url: l.affiliateUrl,
      })),
    };
  });

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    deals: options.allTimeLowOnly
      ? deals.filter((d) => d.analysis.badge === 'ALL_TIME_LOW')
      : deals,
  };
}

/**
 * Retorna detalhes do produto canônico pelo slug com histórico completo para gráficos.
 */
export async function getDealDetailBySlug(db: TenantClient, slug: string) {
  const master = await db.masterProduct.findFirst({
    where: { slug },
    include: {
      listings: {
        where: { inStock: true },
        orderBy: { currentPrice: 'asc' },
        include: {
          history: {
            orderBy: { recordedAt: 'asc' },
            take: 60,
          },
        },
      },
    },
  });

  if (!master) return null;

  const currentPrice = Number(master.currentBestPrice);
  const lowestEver = Number(master.lowestPriceEver);
  const avgPrice = master.averagePrice30d ? Number(master.averagePrice30d) : currentPrice;

  const consolidatedHistory = master.listings.flatMap((l) =>
    l.history.map((h) => ({
      storeName: l.storeName,
      source: l.source,
      price: Number(h.price),
      recordedAt: h.recordedAt,
    })),
  ).sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const bestListing = master.listings[0] ?? null;
  const analysis = analyzeDealPromotion(
    consolidatedHistory,
    currentPrice,
    bestListing?.originalPrice ? Number(bestListing.originalPrice) : null,
  );

  return {
    id: master.id,
    title: master.title,
    cleanTitle: master.cleanTitle,
    slug: master.slug,
    brand: master.brand,
    category: master.category,
    imageUrl: master.imageUrl,
    images: master.images,
    currentBestPrice: currentPrice,
    lowestPriceEver: lowestEver,
    averagePrice30d: avgPrice,
    listingsCount: master.listingsCount,
    analysis,
    listings: master.listings.map((l) => ({
      id: l.id,
      storeName: l.storeName,
      source: l.source,
      currentPrice: Number(l.currentPrice),
      originalPrice: l.originalPrice ? Number(l.originalPrice) : null,
      discountPct: l.discountPct,
      affiliateUrl: l.affiliateUrl,
      imageUrl: l.imageUrl,
      lastCheckedAt: l.lastCheckedAt,
    })),
    priceHistory: consolidatedHistory,
  };
}
