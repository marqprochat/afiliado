import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import { getAdapter } from '@afilados/marketplaces';
import type { ProductData, ProductEnrichJob } from '@afilados/shared';
import { publishEvent } from '../lib/events';

const log = pino({ name: 'product-enrich' });

export interface ProductEnrichDeps {
  fetchProduct?: (kind: ProductEnrichJob['marketplaceKind'], url: string) => Promise<ProductData | null>;
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
    let scraped: ProductData | null = null;
    if (deps.fetchProduct) {
      scraped = await deps.fetchProduct(marketplaceKind, url);
    } else {
      const adapter = getAdapter(marketplaceKind);
      const list = await adapter.fetchByUrls({}, [url]);
      scraped = list[0] ?? null;
    }

    if (!scraped) {
      throw new Error(`Não foi possível extrair dados da URL: ${url}`);
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

    log.info({ productId, title: scraped.title, price: scraped.price }, 'Produto enriquecido com sucesso');

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
