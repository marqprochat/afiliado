import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import {
  createShopeeAdapter,
  getTagAdapter,
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { type MarketplaceKind, type ProductData } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { createHash } from 'node:crypto';

const KEYWORD_CACHE_TTL_SEC = 15 * 60;

export interface DiscoveryDeps {
  searchShopee?: (creds: ShopeeCredentials, keyword: string) => Promise<ProductData[]>;
  /** Sorteio do marketplace (injetável em teste; padrão: aleatório real). */
  pickMarketplace?: (options: MarketplaceKind[]) => MarketplaceKind;
  /** Descoberta por keyword para ML/Amazon/Magalu (injetável em teste). */
  discoverByKeyword?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (keyword: string) => Promise<string[]>>>;
  /** Enriquecimento das URLs descobertas (injetável em teste; padrão: getTagAdapter real). */
  fetchByUrls?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (urls: string[]) => Promise<ProductData[]>>>;
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

function cacheKey(tenantId: string, marketplace: string, keyword: string) {
  return `automation-discover:${tenantId}:${marketplace}:${createHash('sha1').update(keyword).digest('hex')}`;
}

async function cachedDiscoverUrls(
  tenantId: string,
  marketplace: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
  discover: (keyword: string) => Promise<string[]>,
  opts: { cacheEmpty?: boolean } = {},
): Promise<string[]> {
  const key = cacheKey(tenantId, marketplace, keyword);
  const cached = await getRedis().get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // cache corrompido: ignora e busca de novo
    }
  }
  const urls = await discover(keyword);
  // Para ML/Magalu um resultado vazio pode significar sessão expirada ou bloqueio anti-bot
  // (não "sem produtos"), então não cacheamos esse vazio — senão, mesmo depois da sessão ser
  // corrigida, ficaríamos retornando o vazio cacheado por até KEYWORD_CACHE_TTL_SEC. Amazon é
  // anônima e barata, então um vazio ali é só "sem correspondências" e pode ser cacheado.
  if (urls.length > 0 || opts.cacheEmpty !== false) {
    await getRedis()
      .set(key, JSON.stringify(urls), 'EX', KEYWORD_CACHE_TTL_SEC)
      .catch(() => {});
  }
  return urls;
}

async function queueEligibleProducts(rule: AutomationRule, marketplace: MarketplaceKind, results: ProductData[]) {
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
        externalId: p.externalId ?? '',
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
      data: { tenantId: rule.tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: false },
    });
    await prisma.automationLog.create({
      data: { tenantId: rule.tenantId, ruleId: rule.id, marketplace, action: 'DISCOVERED', productId: product.id },
    });
  }
}

async function discoverShopee(rule: AutomationRule, keyword: string, deps: DiscoveryDeps): Promise<ProductData[]> {
  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId: rule.tenantId, kind: 'SHOPEE' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
  const search =
    deps.searchShopee ??
    ((c: ShopeeCredentials, k: string) =>
      createShopeeAdapter().search!(c, {
        source: 'SHOPEE',
        mode: 'keyword',
        query: k,
        sort: 'DISCOUNT_DESC',
        limit: 20,
        topSellers: false,
        extraCommission: false,
      }));
  return search(creds, keyword);
}

const KEYWORD_DISCOVERERS = {
  MERCADOLIVRE: discoverMercadoLivreByKeyword,
  AMAZON: discoverAmazonByKeyword,
  MAGALU: discoverMagaluByKeyword,
} as const;

/**
 * Mercado Livre e Magalu bloqueiam a busca automatizada mesmo com sessão autenticada (validado
 * em testes anteriores com navegador headless) — o caminho funcional para esses dois marketplaces
 * é a extensão Afilados Connect, que copia produtos direto da página que o usuário já navega
 * manualmente. Aqui a busca por palavra-chave fica best-effort (fetch anônimo), sem exigir sessão.
 */
async function discoverScraped(
  marketplace: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
  rule: AutomationRule,
  deps: DiscoveryDeps,
): Promise<ProductData[]> {
  const discoverFn = deps.discoverByKeyword?.[marketplace] ?? ((k: string) => KEYWORD_DISCOVERERS[marketplace](k));
  const urls = await cachedDiscoverUrls(rule.tenantId, marketplace, keyword, discoverFn, {
    cacheEmpty: marketplace === 'AMAZON',
  });
  if (urls.length === 0) {
    // Amazon é busca anônima e vazio ali é só "sem correspondências" — nada a reportar.
    // ML/Magalu bloqueiam esse tipo de busca automatizada (anti-bot); um vazio aqui é
    // esperado e é logado para o usuário saber que a fonte real para eles é a extensão.
    if (marketplace !== 'AMAZON') {
      const marketplaceLabel = marketplace === 'MERCADOLIVRE' ? 'Mercado Livre' : 'Magalu';
      await prisma.automationLog.create({
        data: {
          tenantId: rule.tenantId,
          ruleId: rule.id,
          marketplace,
          action: 'ERROR',
          reason: `busca do ${marketplaceLabel} não retornou nenhum produto — bloqueio anti-bot; use a extensão Afilados Connect para importar produtos deste marketplace`,
        },
      });
    }
    return [];
  }
  const fetchFn = deps.fetchByUrls?.[marketplace] ?? ((u: string[]) => getTagAdapter(marketplace).fetchByUrls({}, u));
  return fetchFn(urls);
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (rule.marketplaces.length === 0) return;
  const pick = deps.pickMarketplace ?? ((options) => options[Math.floor(Math.random() * options.length)]!);
  const marketplace = pick(rule.marketplaces);

  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;

  let results: ProductData[];
  try {
    results =
      marketplace === 'SHOPEE'
        ? await discoverShopee(rule, keyword, deps)
        : await discoverScraped(marketplace, keyword, rule, deps);
  } catch (e) {
    await prisma.automationLog.create({
      data: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        marketplace,
        action: 'ERROR',
        reason: e instanceof Error ? e.message : String(e),
      },
    });
    return;
  }

  await queueEligibleProducts(rule, marketplace, results);
}
