import { z } from 'zod';
import { PRODUCT_SOURCES, SHIPPINGS } from './enums';

export const productDataSchema = z.object({
  source: z.enum(PRODUCT_SOURCES),
  externalId: z.string().min(1).optional(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  originalPrice: z.number().nonnegative().optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
  salesCount: z.number().int().nonnegative().optional(),
  commissionPct: z.number().nonnegative().optional(),
  images: z.array(z.string().url()).default([]),
  shipping: z.enum(SHIPPINGS).default('UNKNOWN'),
  flashSaleEndsAt: z.string().datetime().optional(),
  couponCode: z.string().optional(),
  couponValue: z.number().nonnegative().optional(),
  originalUrl: z.string().url(),
  shopId: z.string().optional(),
  shopName: z.string().optional(),
  raw: z.unknown(),
});
export type ProductData = z.infer<typeof productDataSchema>;
