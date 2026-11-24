import { createHash } from 'node:crypto';
import type { TenantClient } from '@afilados/db';
import { MARKETPLACE_KINDS, type MarketplaceKind, type ProductData } from '@afilados/shared';
import {
  normalizeProductTitle,
  findBestProductMatch,
  listingConflictsWithMaster,
  analyzeDealPromotion,
  formatBRL,
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
  if (/\b(smartphone|iphone|galaxy|celular|motorola|xiaomi)\b/i.test(lower))
    return 'Celulares & Smartphones';
  if (/\b(tv|smart tv|televis[aã]o|monitor|oled|qled)\b/i.test(lower)) return 'TV & Vídeo';
  if (/\b(notebook|laptop|computador|pc|gamer|macbook|teclado|mouse)\b/i.test(lower))
    return 'Informática';
  if (
    /\b(air fryer|fritadeira|geladeira|fog[aã]o|micro-ondas|cafeteira|liquidificador|aspirador)\b/i.test(
      lower,
    )
  )
    return 'Eletrodomésticos';
  if (/\b(fone|headphone|headset|jbl|caixa de som|bluetooth|earbuds|airpods)\b/i.test(lower))
    return 'Áudio & Som';
  if (/\b(playstation|ps5|ps4|xbox|nintendo|switch|game)\b/i.test(lower)) return 'Games & Consoles';
  if (/\b(relogio|smartwatch|relogio inteligente|apple watch)\b/i.test(lower))
    return 'Smartwatches';
  return 'Geral & Ofertas';
}

export interface IndexProductOptions {
  /** Link de afiliado convertido no envio. Sem ele, a listagem mantém o link já gravado. */
  affiliateUrl?: string;
}

export interface IndexProductResult {
  masterProductId: string;
  slug: string;
  isNewMaster: boolean;
  isPriceDrop: boolean;
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
  opts: IndexProductOptions = {},
): Promise<IndexProductResult> {
  const norm = normalizeProductTitle(item.title);
  const externalId = item.externalId ?? createHash('sha1').update(item.originalUrl).digest('hex');
  const storeName = formatStoreName(item.source, item.shopName);

  // Extrai possível EAN de item.raw se disponível
  const rawObj = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<
    string,
    unknown
  >;
  const eanCandidate = (rawObj.ean ?? rawObj.gtin ?? rawObj.barcode ?? null) as string | null;
  const cleanEan =
    eanCandidate && String(eanCandidate).trim().length >= 8 ? String(eanCandidate).trim() : null;
  const existingListing = await db.productListing.findFirst({
    where: { source: item.source, externalId },
  });

  // 0. A oferta já existe: só continua no produto atual se ele for compatível (mesmo EAN ou
  // mesmas variantes). Se não for, refaz o match; o histórico é da listagem e vai junto.
  let matchedMasterId: string | null = null;
  let displacedMasterId: string | null = null;
  if (existingListing) {
    const currentMaster = await db.masterProduct.findFirst({
      where: { id: existingListing.masterProductId },
      select: { id: true, title: true, ean: true },
    });
    if (
      currentMaster &&
      listingConflictsWithMaster({ title: item.title, ean: cleanEan }, currentMaster)
    ) {
      displacedMasterId = currentMaster.id;
    } else {
      matchedMasterId = existingListing.masterProductId;
    }
  }

  // 1. Busca por EAN exato se disponível
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
      where: {
        ...(norm.brand ? { brand: norm.brand } : {}),
        ...(displacedMasterId ? { id: { not: displacedMasterId } } : {}),
      },
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
    masterId = await createMasterProduct(db, tenantId, {
      title: item.title,
      ean: cleanEan,
      images: item.images,
      price: item.price,
    });
  }

  // 3. Atualiza ou cria a oferta da loja (ProductListing)
  const currentPriceNum = Number(item.price);
  const originalPriceNum = item.originalPrice ? Number(item.originalPrice) : null;

  if (existingListing) {
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
        affiliateUrl: opts.affiliateUrl ?? existingListing.affiliateUrl ?? item.originalUrl,
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
        affiliateUrl: opts.affiliateUrl ?? item.originalUrl,
        currentPrice: currentPriceNum,
        originalPrice: originalPriceNum,
        discountPct: item.discountPct ?? null,
        imageUrl: item.images[0] ?? null,
        inStock: true,
      },
    });

    // Registra primeiro ponto no histórico
    await db.priceHistory.create({
      data: {
        listingId: createdListing.id,
        price: currentPriceNum,
        originalPrice: originalPriceNum,
      },
    });
  }

  // 4. Recalcula métricas do MasterProduct (e do antigo, se a listagem saiu dele)
  const metrics = await recomputeMasterMetrics(db, masterId);
  if (!metrics) throw new Error(`MasterProduct ${masterId} não encontrado após indexar`);
  if (displacedMasterId && displacedMasterId !== masterId) {
    await recomputeMasterMetrics(db, displacedMasterId);
  }

  // 5. Verifica e processa alertas cadastrados
  await checkAndNotifyPriceAlerts(db, masterId, metrics.currentBestPrice ?? currentPriceNum);

  return { masterProductId: masterId, slug: metrics.slug, isNewMaster, isPriceDrop };
}

/** Cria a página (MasterProduct) de um produto novo; o slug ganha um sufixo aleatório. */
export async function createMasterProduct(
  db: TenantClient,
  tenantId: string,
  data: { title: string; ean: string | null; images: string[]; price: number },
): Promise<string> {
  const norm = normalizeProductTitle(data.title);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  const created = await db.masterProduct.create({
    data: {
      tenantId,
      title: norm.cleanTitle,
      cleanTitle: norm.cleanTitle,
      slug: `${norm.slug}-${randomSuffix}`,
      brand: norm.brand ?? null,
      ean: data.ean,
      category: inferCategory(data.title),
      imageUrl: data.images[0] ?? null,
      images: data.images,
      lowestPriceEver: data.price,
      averagePrice30d: data.price,
      currentBestPrice: data.price,
      listingsCount: 1,
    },
  });
  return created.id;
}

export interface MasterMetrics {
  slug: string;
  /** null quando o produto ficou sem listagens em estoque (os campos de preço não mudam). */
  currentBestPrice: number | null;
  listingsCount: number;
}

/**
 * Recalcula currentBestPrice, lowestPriceEver, averagePrice30d, bestListingId e listingsCount
 * a partir das listagens em estoque do produto e do histórico delas. Produto sem listagens é
 * mantido (pode ter alertas), só com listingsCount 0 e sem melhor listagem.
 * Devolve null se o produto não existe.
 */
export async function recomputeMasterMetrics(
  db: TenantClient,
  masterId: string,
): Promise<MasterMetrics | null> {
  const master = await db.masterProduct.findFirst({
    where: { id: masterId },
    select: { slug: true, lowestPriceEver: true },
  });
  if (!master) return null;

  const listings = await db.productListing.findMany({
    where: { masterProductId: masterId, inStock: true },
    select: { id: true, currentPrice: true },
  });

  if (listings.length === 0) {
    await db.masterProduct.updateMany({
      where: { id: masterId },
      data: { listingsCount: 0, bestListingId: null },
    });
    return { slug: master.slug, currentBestPrice: null, listingsCount: 0 };
  }

  const priced = listings.filter((l) => Number(l.currentPrice) > 0);
  const bestListing =
    priced.length > 0
      ? priced.reduce((best, l) => (Number(l.currentPrice) < Number(best.currentPrice) ? l : best))
      : listings[0]!;
  const bestPrice = Number(bestListing.currentPrice);

  const history = await db.priceHistory.findMany({
    where: { listingId: { in: listings.map((l) => l.id) } },
    select: { price: true },
  });
  const recorded = history.map((h) => Number(h.price)).filter((p) => p > 0);
  const avg30d =
    recorded.length > 0
      ? Number((recorded.reduce((a, b) => a + b, 0) / recorded.length).toFixed(2))
      : bestPrice;
  // Menor preço só das listagens que ficaram: listagem de outro produto que saiu leva junto o
  // preço dela (antes o mínimo era acumulado e ficava poluído para sempre).
  const lowestEver = Math.min(bestPrice, ...recorded);

  await db.masterProduct.updateMany({
    where: { id: masterId },
    data: {
      currentBestPrice: bestPrice,
      lowestPriceEver: lowestEver,
      averagePrice30d: avg30d,
      bestListingId: bestListing.id,
      listingsCount: listings.length,
      updatedAt: new Date(),
    },
  });
  return { slug: master.slug, currentBestPrice: bestPrice, listingsCount: listings.length };
}

/**
 * Sincroniza os produtos já salvos e o catálogo Awin para a vitrine.
 */
export async function syncDealsCatalog(db: TenantClient, tenantId: string) {
  const pageSize = 100;
  const result = { productsProcessed: 0, awinProcessed: 0, indexed: 0, failed: 0 };
  async function index(data: ProductData) {
    try {
      await indexProductInPriceEngine(db, tenantId, data);
      result.indexed += 1;
    } catch {
      result.failed += 1;
    }
  }

  let productOffset = 0;
  while (true) {
    const rows = await db.product.findMany({
      take: pageSize,
      skip: productOffset,
      orderBy: { createdAt: 'desc' },
    });
    for (const p of rows) {
      result.productsProcessed += 1;
      const price = Number(p.price);
      if (!price || price <= 0) continue;
      await index({
        source: p.source,
        externalId: p.externalId ?? p.id,
        title: p.title,
        price,
        images: p.images,
        shipping: p.shipping,
        originalUrl: p.originalUrl,
        raw: (p.raw && typeof p.raw === 'object' ? p.raw : {}) as Record<string, unknown>,
        ...(p.originalPrice ? { originalPrice: Number(p.originalPrice) } : {}),
        ...(p.discountPct !== null && p.discountPct !== undefined
          ? { discountPct: p.discountPct }
          : {}),
        ...(p.salesCount !== null && p.salesCount !== undefined
          ? { salesCount: p.salesCount }
          : {}),
        ...(p.commissionPct ? { commissionPct: Number(p.commissionPct) } : {}),
        ...(p.shopId ? { shopId: p.shopId } : {}),
        ...(p.shopName ? { shopName: p.shopName } : {}),
      });
    }
    productOffset += rows.length;
    if (rows.length < pageSize) break;
  }

  let awinOffset = 0;
  while (true) {
    const rows = await db.awinCatalogProduct.findMany({
      take: pageSize,
      skip: awinOffset,
      orderBy: { lastImportedAt: 'desc' },
    });
    for (const aw of rows) {
      result.awinProcessed += 1;
      const price = Number(aw.price);
      if (!price || price <= 0) continue;
      await index({
        source: 'AWIN',
        externalId: aw.externalId,
        title: aw.title,
        price,
        images: aw.imageUrl ? [aw.imageUrl] : [],
        shipping: 'UNKNOWN',
        originalUrl: aw.deepLink,
        raw: (aw.raw && typeof aw.raw === 'object' ? aw.raw : {}) as Record<string, unknown>,
        ...(aw.originalPrice ? { originalPrice: Number(aw.originalPrice) } : {}),
        ...(aw.advertiserName ? { shopName: aw.advertiserName } : {}),
      });
    }
    awinOffset += rows.length;
    if (rows.length < pageSize) break;
  }
  return result;
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
    const shouldTrigger = alert.notifyOnAnyDrop || (target !== null && currentPrice <= target);

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

  // Produto que ficou sem listagens (ofertas movidas para o produto certo) não aparece na vitrine.
  const where: Record<string, unknown> = { listingsCount: { gt: 0 } };

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
export interface DealCoupon {
  code: string;
  description: string;
  discountLabel: string | null;
  expiresAt: Date | null;
}

const MAX_STORE_COUPONS = 3;

function couponDiscountLabel(
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null,
  value: unknown,
): string | null {
  if (type === 'FREE_SHIPPING') return 'Frete grátis';
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (type === 'PERCENT') return `${n}% OFF`;
  if (type === 'FIXED') return `${formatBRL(n)} OFF`;
  return null;
}

/**
 * Cupom da página da oferta: o capturado com o produto da melhor listagem; senão, até 3 cupons
 * válidos e não expirados da mesma loja, do maior desconto para o menor.
 */
async function findDealCoupons(
  db: TenantClient,
  listing: { source: string; externalId: string } | null,
): Promise<DealCoupon[]> {
  if (!listing) return [];
  const product = await db.product.findFirst({
    where: {
      source: listing.source as ProductData['source'],
      externalId: listing.externalId,
      couponCode: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { couponCode: true },
  });
  if (product?.couponCode) {
    return [
      {
        code: product.couponCode,
        description: 'Cupom desta oferta',
        // Product.couponValue não diz o tipo do desconto: a planilha e a extensão gravam reais,
        // mas o cupom da Awin grava o discountValue, que pode ser percentual. Sem saber o tipo,
        // é melhor não mostrar rótulo do que mostrar um errado.
        discountLabel: null,
        expiresAt: null,
      },
    ];
  }
  if (!(MARKETPLACE_KINDS as readonly string[]).includes(listing.source)) return [];
  const rows = await db.coupon.findMany({
    where: {
      store: listing.source as MarketplaceKind,
      status: 'VALID',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { discountValue: { sort: 'desc', nulls: 'last' } },
    take: MAX_STORE_COUPONS,
    select: {
      code: true,
      description: true,
      discountType: true,
      discountValue: true,
      expiresAt: true,
    },
  });
  return rows.map((c) => ({
    code: c.code,
    description: c.description,
    discountLabel: couponDiscountLabel(c.discountType, c.discountValue),
    expiresAt: c.expiresAt,
  }));
}

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

  const consolidatedHistory = master.listings
    .flatMap((l) =>
      l.history.map((h) => ({
        storeName: l.storeName,
        source: l.source,
        price: Number(h.price),
        recordedAt: h.recordedAt,
      })),
    )
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const bestListing = master.listings[0] ?? null;
  const analysis = analyzeDealPromotion(
    consolidatedHistory,
    currentPrice,
    bestListing?.originalPrice ? Number(bestListing.originalPrice) : null,
  );
  const coupons = await findDealCoupons(
    db,
    bestListing ? { source: bestListing.source, externalId: bestListing.externalId } : null,
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
    coupons,
  };
}
