import type { Job } from 'bullmq';
import pino from 'pino';
import { createHash } from 'node:crypto';
import { prisma, decryptJson } from '@afilados/db';
import { createShopeeAdapter, getTagAdapter, type ShopeeCredentials } from '@afilados/marketplaces';
import type { ProductData, ProductEnrichJob } from '@afilados/shared';
import { publishEvent } from '../lib/events';
import { getRedis } from '../lib/redis';
import { loadTagCredentials } from '../lib/marketplace-credentials';

const log = pino({ name: 'product-enrich' });

/** Metadados raspados ficam em cache por 2h: a mesma URL importada de novo não bate no site. */
export const ENRICH_CACHE_TTL_SEC = 2 * 60 * 60;

export interface ProductEnrichDeps {
  fetchProduct?: (
    kind: ProductEnrichJob['marketplaceKind'],
    url: string,
  ) => Promise<ProductData | null>;
  /** Cache injetável (padrão: Redis). */
  cache?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSec: number): Promise<void>;
  };
}

function cacheKey(kind: string, url: string) {
  return `enrich:${kind}:${createHash('sha1').update(url).digest('hex')}`;
}

function redisCache(): NonNullable<ProductEnrichDeps['cache']> {
  return {
    get: (k) => getRedis().get(k),
    set: async (k, v, ttl) => {
      await getRedis().set(k, v, 'EX', ttl);
    },
  };
}

async function fetchViaAdapter(
  tenantId: string,
  kind: ProductEnrichJob['marketplaceKind'],
  url: string,
): Promise<ProductData | null> {
  if (kind === 'SHOPEE') {
    const conn = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: 'SHOPEE' },
    });
    if (!conn?.encryptedCredentials) throw new Error('Shopee não configurada para este tenant');
    const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
    const list = await createShopeeAdapter().fetchByUrls(creds, [url]);
    return list[0] ?? null;
  }
  const creds = kind === 'AMAZON' ? await loadTagCredentials(tenantId, kind) : {};
  const list = await getTagAdapter(kind).fetchByUrls(creds, [url]);
  return list[0] ?? null;
}

export async function enrichProduct(
  deps: ProductEnrichDeps,
  jobData: ProductEnrichJob,
): Promise<{ success: boolean; productId: string; error?: string }> {
  const { tenantId, productId, url, marketplaceKind } = jobData;

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });

  if (!product) {
    log.warn({ productId, tenantId }, 'Produto não encontrado para enriquecimento');
    return { success: false, productId, error: 'product-not-found' };
  }

  try {
    const cache = deps.cache ?? redisCache();
    const key = cacheKey(marketplaceKind, url);
    let scraped: ProductData | null = null;
    let fromCache = false;

    const cached = await cache.get(key).catch(() => null);
    if (cached) {
      try {
        scraped = JSON.parse(cached) as ProductData;
        fromCache = true;
      } catch {}
    }

    if (!scraped) {
      scraped = deps.fetchProduct
        ? await deps.fetchProduct(marketplaceKind, url)
        : await fetchViaAdapter(tenantId, marketplaceKind, url);
    }

    if (!scraped) {
      throw new Error(`Não foi possível extrair dados da URL: ${url}`);
    }
    if (!fromCache) {
      await cache.set(key, JSON.stringify(scraped), ENRICH_CACHE_TTL_SEC).catch((e: unknown) => {
        log.warn({ err: e }, 'falha ao gravar cache de enriquecimento');
      });
    }

    await prisma.product.updateMany({
      where: { id: productId, tenantId },
      data: {
        title: scraped.title,
        price: scraped.price,
        originalPrice: scraped.originalPrice ?? null,
        discountPct: scraped.discountPct ?? null,
        images: scraped.images,
        shipping: scraped.shipping,
        couponCode: scraped.couponCode ?? null,
        couponValue: scraped.couponValue ?? null,
        flashSaleEndsAt: scraped.flashSaleEndsAt ? new Date(scraped.flashSaleEndsAt) : null,
        raw: scraped.raw as object,
      },
    });

    // Atualiza QueueItems se estiverem em PENDING_ENRICH
    await prisma.queueItem.updateMany({
      where: { productId, tenantId, status: 'PENDING_ENRICH' },
      data: { status: 'PENDING' },
    });

    log.info(
      { productId, title: scraped.title, price: scraped.price, fromCache },
      'Produto enriquecido com sucesso',
    );

    await publishEvent(tenantId, {
      type: 'product.enriched',
      productId,
      status: 'SUCCESS',
    });
    await publishEvent(tenantId, { type: 'queue.updated' });

    return { success: true, productId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ productId, url, error: errorMsg }, 'Falha ao enriquecer produto');

    await prisma.queueItem.updateMany({
      where: { productId, tenantId, status: 'PENDING_ENRICH' },
      data: { status: 'ERROR' },
    });

    await publishEvent(tenantId, {
      type: 'product.enriched',
      productId,
      status: 'ERROR',
      error: errorMsg,
    });

    return { success: false, productId, error: errorMsg };
  }
}

export function createProductEnrichProcessor(deps: ProductEnrichDeps = {}) {
  return async (job: Job<ProductEnrichJob>) => {
    return enrichProduct(deps, job.data);
  };
}
