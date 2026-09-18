import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import {
  createShopeeAdapter,
  getTagAdapter,
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
  fetchRenderedHtml,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { SESSION_FIELD_BY_KIND, type MarketplaceKind, type ProductData, type TagCredentials } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { createHash } from 'node:crypto';

const KEYWORD_CACHE_TTL_SEC = 15 * 60;

/** Domínio a usar ao injetar os cookies de sessão sincronizados no navegador headless. */
const SESSION_COOKIE_DOMAIN: Record<'MERCADOLIVRE' | 'MAGALU', string> = {
  MERCADOLIVRE: '.mercadolivre.com.br',
  MAGALU: '.magazineluiza.com.br',
};

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
  await getRedis()
    .set(key, JSON.stringify(urls), 'EX', KEYWORD_CACHE_TTL_SEC)
    .catch(() => {});
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
 * Mercado Livre e Magalu bloqueiam a busca tanto para fetch simples quanto para navegador
 * headless anônimo (validado nas Tasks 1 e 2) — só funcionam autenticados com a sessão que a
 * extensão Afilados Connect já sincroniza para gerar link de afiliado oficial. Sem essa sessão,
 * não adianta tentar: lança para o chamador logar ERROR e pular a rodada.
 */
async function loadSessionCookies(
  tenantId: string,
  kind: 'MERCADOLIVRE' | 'MAGALU',
): Promise<Record<string, string>> {
  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
  const creds = conn?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials))
    : null;
  const session = creds?.[SESSION_FIELD_BY_KIND[kind]];
  if (!session?.cookies) {
    throw new Error(
      `sessão do ${kind === 'MERCADOLIVRE' ? 'Mercado Livre' : 'Magalu'} não sincronizada — sincronize pela extensão Afilados Connect`,
    );
  }
  return session.cookies;
}

async function discoverScraped(
  marketplace: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
  rule: AutomationRule,
  deps: DiscoveryDeps,
): Promise<ProductData[]> {
  let discoverFn = deps.discoverByKeyword?.[marketplace];
  if (!discoverFn) {
    if (marketplace === 'AMAZON') {
      discoverFn = (k: string) => discoverAmazonByKeyword(k);
    } else {
      const cookies = await loadSessionCookies(rule.tenantId, marketplace);
      const authenticatedFetch = (url: string) =>
        fetchRenderedHtml(url, { cookies: { domain: SESSION_COOKIE_DOMAIN[marketplace], values: cookies } });
      discoverFn = (k: string) => KEYWORD_DISCOVERERS[marketplace](k, { fetchHtml: authenticatedFetch });
    }
  }
  const urls = await cachedDiscoverUrls(rule.tenantId, marketplace, keyword, discoverFn);
  if (urls.length === 0) return [];
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
