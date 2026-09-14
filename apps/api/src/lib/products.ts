import { createHash } from 'node:crypto';
import type { Product, TenantClient } from '@afilados/db';
import type { ProductData } from '@afilados/shared';

export function toApiProduct(p: Product) {
  return {
    ...p,
    price: Number(p.price),
    originalPrice: p.originalPrice === null ? null : Number(p.originalPrice),
    commissionPct: p.commissionPct === null ? null : Number(p.commissionPct),
    couponValue: p.couponValue === null ? null : Number(p.couponValue),
  };
}
export type ApiProduct = ReturnType<typeof toApiProduct>;

export async function upsertProducts(
  db: TenantClient,
  tenantId: string,
  items: ProductData[],
): Promise<Product[]> {
  const out: Product[] = [];
  for (const it of items) {
    const externalId = it.externalId ?? createHash('sha1').update(it.originalUrl).digest('hex');
    const data = {
      title: it.title,
      price: it.price,
      originalPrice: it.originalPrice ?? null,
      discountPct: it.discountPct ?? null,
      salesCount: it.salesCount ?? null,
      commissionPct: it.commissionPct ?? null,
      images: it.images,
      shipping: it.shipping,
      flashSaleEndsAt: it.flashSaleEndsAt ? new Date(it.flashSaleEndsAt) : null,
      couponCode: it.couponCode ?? null,
      couponValue: it.couponValue ?? null,
      originalUrl: it.originalUrl,
      shopId: it.shopId ?? null,
      shopName: it.shopName ?? null,
      raw: it.raw as object,
    };
    const row = await db.product.upsert({
      where: { tenantId_source_externalId: { tenantId, source: it.source, externalId } },
      update: data,
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      create: { source: it.source, externalId, ...data },
    });
    out.push(row);
  }
  return out;
}
