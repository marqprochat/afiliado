import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import { createShopeeAdapter, type ShopeeCredentials } from '@afilados/marketplaces';
import type { ProductData } from '@afilados/shared';

export interface DiscoveryDeps {
  searchShopee?: (creds: ShopeeCredentials, keyword: string) => Promise<ProductData[]>;
}

function matchesFilters(
  p: ProductData,
  rule: Pick<AutomationRule, 'blockedKeywords' | 'minDiscountPct' | 'minPrice' | 'maxPrice'>,
): boolean {
  const title = p.title.toLowerCase();
  if (rule.blockedKeywords.some((k) => title.includes(k.toLowerCase()))) return false;
  if (rule.minDiscountPct != null && (p.discountPct ?? 0) < rule.minDiscountPct) return false;
  if (rule.minPrice != null && p.price < Number(rule.minPrice)) return false;
  if (rule.maxPrice != null && p.price > Number(rule.maxPrice)) return false;
  return true;
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (!rule.marketplaces.includes('SHOPEE')) return;
  const conn = await prisma.marketplaceConnection.findFirst({
    where: { tenantId: rule.tenantId, kind: 'SHOPEE' },
  });
  if (!conn?.encryptedCredentials) return;
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
  const search =
    deps.searchShopee ??
    ((c: ShopeeCredentials, keyword: string) =>
      createShopeeAdapter().search!(c, {
        source: 'SHOPEE',
        mode: 'keyword',
        query: keyword,
        sort: 'DISCOUNT_DESC',
        limit: 20,
        topSellers: false,
        extraCommission: false,
      }));

  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;
  const results = await search(creds, keyword);
  const eligible = results.filter((p) => matchesFilters(p, rule));

  for (const p of eligible) {
    const product = await prisma.product.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId: rule.tenantId,
          source: p.source,
          externalId: p.externalId ?? '',
        },
      },
      update: {
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        raw: p.raw as object,
      },
      create: {
        tenantId: rule.tenantId,
        source: p.source,
        externalId: p.externalId ?? null,
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        originalUrl: p.originalUrl,
        raw: p.raw as object,
      },
    });
    const already = await prisma.automationQueueItem.findFirst({
      where: { ruleId: rule.id, productId: product.id },
    });
    if (already) continue;
    await prisma.automationQueueItem.create({
      data: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        kind: 'PRODUCT',
        productId: product.id,
        manual: false,
      },
    });
  }
}
