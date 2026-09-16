import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '@afilados/db';
import type { ProductData } from '@afilados/shared';
import { enrichProduct } from '../src/processors/product-enrich';

vi.mock('../src/lib/events', () => ({
  publishEvent: vi.fn(),
}));

describe('Product Enrich Processor', () => {
  let tenantId: string;

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Tenant Enrich' },
    });
    tenantId = tenant.id;
  });

  it('enriquece produto existente e atualiza status do QueueItem de PENDING_ENRICH para PENDING', async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        source: 'MERCADOLIVRE',
        externalId: 'MLB999111',
        title: 'Produto Temporário',
        price: 0,
        originalUrl: 'https://produto.mercadolivre.com.br/MLB-999111-teste.html',
        raw: {},
      },
    });

    const queueItem = await prisma.queueItem.create({
      data: {
        tenantId,
        productId: product.id,
        status: 'PENDING_ENRICH',
      },
    });

    const mockScraped: ProductData = {
      source: 'MERCADOLIVRE',
      externalId: 'MLB999111',
      title: 'Fritadeira Air Fryer Mondial 4L',
      price: 299.9,
      originalPrice: 499.9,
      discountPct: 40,
      images: ['https://http2.mlstatic.com/foto1.jpg'],
      shipping: 'FULL',
      couponCode: 'OFF10',
      originalUrl: 'https://produto.mercadolivre.com.br/MLB-999111-teste.html',
      raw: { ok: true },
    };

    const store = new Map<string, string>();
    const cache = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    };
    const fetchProduct = vi.fn().mockResolvedValue(mockScraped);
    const job = {
      tenantId,
      productId: product.id,
      url: product.originalUrl,
      marketplaceKind: 'MERCADOLIVRE' as const,
    };

    const res = await enrichProduct({ fetchProduct, cache }, job);
    expect(res.success).toBe(true);
    expect(fetchProduct).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);

    // Segunda vez vem do cache (2h) e não raspa o site de novo
    const res2 = await enrichProduct({ fetchProduct, cache }, job);
    expect(res2.success).toBe(true);
    expect(fetchProduct).toHaveBeenCalledTimes(1);

    const updatedProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });
    expect(updatedProduct?.title).toBe('Fritadeira Air Fryer Mondial 4L');
    expect(Number(updatedProduct?.price)).toBe(299.9);
    expect(Number(updatedProduct?.originalPrice)).toBe(499.9);
    expect(updatedProduct?.discountPct).toBe(40);
    expect(updatedProduct?.shipping).toBe('FULL');
    expect(updatedProduct?.couponCode).toBe('OFF10');

    const updatedQueueItem = await prisma.queueItem.findUnique({
      where: { id: queueItem.id },
    });
    expect(updatedQueueItem?.status).toBe('PENDING');
  });

  it('retorna erro se produto não existir no banco', async () => {
    const res = await enrichProduct(
      {},
      {
        tenantId,
        productId: 'non-existent-id',
        url: 'https://www.amazon.com.br/dp/B012345',
        marketplaceKind: 'AMAZON',
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('product-not-found');
  });
});
