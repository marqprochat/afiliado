import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import {
  createShopeeAdapter,
  getAliexpressAdapter,
  getTagAdapter,
  discoverMercadoLivreByKeyword,
  discoverAmazonByKeyword,
  discoverMagaluByKeyword,
  type AliexpressCredentials,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import {
  type MarketplaceKind,
  type ProductData,
  mapAwinCatalogRowToProductData,
  automationDiscoveringKey,
} from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { publishEvent } from '../lib/events';
import { createHash } from 'node:crypto';
import { loadTagCredentials } from '../lib/marketplace-credentials';

const KEYWORD_CACHE_TTL_SEC = 15 * 60;
/** TTL de segurança do selo "buscando" — evita ficar travado para sempre se o worker cair no meio da busca. */
const DISCOVERING_TTL_SEC = 5 * 60;

export interface DiscoveryDeps {
  searchShopee?: (creds: ShopeeCredentials, keyword: string) => Promise<ProductData[]>;
  searchAliexpress?: (creds: AliexpressCredentials, keyword: string) => Promise<ProductData[]>;
  /** Descoberta por keyword para ML/Amazon/Magalu (injetável em teste). */
  discoverByKeyword?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (keyword: string) => Promise<string[]>>>;
  /** Enriquecimento das URLs descobertas (injetável em teste; padrão: getTagAdapter real). */
  fetchByUrls?: Partial<Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', (urls: string[]) => Promise<ProductData[]>>>;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * A busca por palavra-chave dos marketplaces é fuzzy: a Shopee mistura itens só parecidos e o
 * AliExpress ainda traduz o termo (buscar "notebook" traz caderno, bloco de notas e estojo).
 * A keyword da regra é obrigatória para o usuário, então ela é reaplicada aqui sobre o título —
 * cada palavra dela precisa aparecer, ignorando acentos e caixa.
 */
function matchesKeyword(title: string, keyword: string): boolean {
  const normalizedTitle = normalizeText(title);
  const tokens = normalizeText(keyword).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => normalizedTitle.includes(token));
}

function matchesFilters(
  p: ProductData,
  rule: Pick<AutomationRule, 'blockedKeywords' | 'minDiscountPct' | 'minPrice' | 'maxPrice'>,
  keyword: string,
): boolean {
  const title = p.title.toLowerCase();
  if (!matchesKeyword(p.title, keyword)) return false;
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

async function queueDiscoveredProduct(rule: AutomationRule, marketplace: MarketplaceKind, p: ProductData) {
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
  if (already) return;
  await prisma.automationQueueItem.create({
    data: { tenantId: rule.tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: false },
  });
  await prisma.automationLog.create({
    data: { tenantId: rule.tenantId, ruleId: rule.id, marketplace, action: 'DISCOVERED', productId: product.id },
  });
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

async function discoverAliexpress(rule: AutomationRule, keyword: string, deps: DiscoveryDeps): Promise<ProductData[]> {
  const conn = await prisma.marketplaceConnection.findFirst({ where: { tenantId: rule.tenantId, kind: 'ALIEXPRESS' } });
  if (!conn?.encryptedCredentials) return [];
  const creds = decryptJson<AliexpressCredentials>(Buffer.from(conn.encryptedCredentials));
  const search =
    deps.searchAliexpress ??
    ((c: AliexpressCredentials, k: string) =>
      getAliexpressAdapter().search!(c, {
        source: 'ALIEXPRESS',
        mode: 'keyword',
        query: k,
        sort: 'DISCOUNT_DESC',
        limit: 20,
      }));
  return search(creds, keyword);
}

async function discoverAwin(rule: AutomationRule, keyword: string): Promise<ProductData[]> {
  const rows = await prisma.awinCatalogProduct.findMany({
    where: { tenantId: rule.tenantId, title: { contains: keyword, mode: 'insensitive' } },
    take: 20,
  });
  return rows.map((r) =>
    mapAwinCatalogRowToProductData({
      feedId: r.feedId,
      externalId: r.externalId,
      title: r.title,
      price: Number(r.price),
      originalPrice: r.originalPrice !== null ? Number(r.originalPrice) : null,
      imageUrl: r.imageUrl,
      deepLink: r.deepLink,
      raw: r.raw,
    }),
  );
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
  const fetchFn =
    deps.fetchByUrls?.[marketplace] ??
    (async (u: string[]) => {
      const creds = marketplace === 'AMAZON' ? await loadTagCredentials(rule.tenantId, marketplace) : {};
      return getTagAdapter(marketplace).fetchByUrls(creds, u);
    });
  return fetchFn(urls);
}

async function searchOneMarketplace(
  marketplace: MarketplaceKind,
  rule: AutomationRule,
  keyword: string,
  deps: DiscoveryDeps,
): Promise<ProductData[]> {
  if (marketplace === 'SHOPEE') return discoverShopee(rule, keyword, deps);
  if (marketplace === 'ALIEXPRESS') return discoverAliexpress(rule, keyword, deps);
  if (marketplace === 'AWIN') return discoverAwin(rule, keyword);
  return discoverScraped(marketplace, keyword, rule, deps);
}

/**
 * Cota base por marketplace = floor(maxOffersPerDay / nº de marketplaces selecionados); a sobra
 * da divisão não exata fica sem uso. Quando um marketplace não atinge sua cota (poucos
 * elegíveis, erro ou bloqueio anti-bot), a diferença é redistribuída em rodízio pelos
 * marketplaces que sobraram itens além da própria cota — sem nenhuma chamada extra às APIs, só
 * usando o que a busca com folga (~20 por marketplace) já trouxe.
 */
function distributeWithQuota(
  marketplaces: MarketplaceKind[],
  resultsByMarketplace: Map<MarketplaceKind, ProductData[]>,
  quota: number,
): Map<MarketplaceKind, ProductData[]> {
  const taken = new Map<MarketplaceKind, ProductData[]>();
  for (const m of marketplaces) {
    const results = resultsByMarketplace.get(m) ?? [];
    taken.set(m, results.slice(0, Math.min(quota, results.length)));
  }
  let shortfall = 0;
  for (const m of marketplaces) shortfall += Math.max(0, quota - taken.get(m)!.length);

  let progressed = true;
  while (shortfall > 0 && progressed) {
    progressed = false;
    for (const m of marketplaces) {
      if (shortfall <= 0) break;
      const results = resultsByMarketplace.get(m) ?? [];
      const current = taken.get(m)!;
      if (current.length < results.length) {
        taken.set(m, [...current, results[current.length]!]);
        shortfall--;
        progressed = true;
      }
    }
  }
  return taken;
}

/** Intercala os itens já decididos por marketplace, um de cada vez, na ordem de rule.marketplaces. */
function interleaveByMarketplace(
  marketplaces: MarketplaceKind[],
  taken: Map<MarketplaceKind, ProductData[]>,
): { marketplace: MarketplaceKind; product: ProductData }[] {
  const cursors = new Map<MarketplaceKind, number>(marketplaces.map((m) => [m, 0]));
  const out: { marketplace: MarketplaceKind; product: ProductData }[] = [];
  const total = [...taken.values()].reduce((sum, arr) => sum + arr.length, 0);
  while (out.length < total) {
    for (const m of marketplaces) {
      const items = taken.get(m)!;
      const cursor = cursors.get(m)!;
      if (cursor < items.length) {
        out.push({ marketplace: m, product: items[cursor]! });
        cursors.set(m, cursor + 1);
      }
    }
  }
  return out;
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (rule.marketplaces.length === 0) return;
  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;

  const quota = Math.floor(rule.maxOffersPerDay / rule.marketplaces.length);
  if (quota <= 0) return;

  const discoveringKey = automationDiscoveringKey(rule.id);
  await getRedis().set(discoveringKey, '1', 'EX', DISCOVERING_TTL_SEC).catch(() => {});
  await publishEvent(rule.tenantId, { type: 'automation.discovery', ruleId: rule.id, discovering: true }).catch(
    () => {},
  );

  try {
    const resultsByMarketplace = new Map<MarketplaceKind, ProductData[]>();
    for (const marketplace of rule.marketplaces) {
      let raw: ProductData[];
      try {
        raw = await searchOneMarketplace(marketplace, rule, keyword, deps);
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
        raw = [];
      }
      resultsByMarketplace.set(marketplace, raw.filter((p) => matchesFilters(p, rule, keyword)));
    }

    const taken = distributeWithQuota(rule.marketplaces, resultsByMarketplace, quota);
    const interleaved = interleaveByMarketplace(rule.marketplaces, taken);
    for (const { marketplace, product } of interleaved) {
      await queueDiscoveredProduct(rule, marketplace, product);
    }
  } finally {
    await getRedis().del(discoveringKey).catch(() => {});
    await publishEvent(rule.tenantId, { type: 'automation.discovery', ruleId: rule.id, discovering: false }).catch(
      () => {},
    );
  }
}
