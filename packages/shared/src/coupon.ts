import { z } from 'zod';
import {
  MARKETPLACE_KINDS,
  COUPON_ORIGINS,
  COUPON_STATUSES,
  COUPON_DISCOUNT_TYPES,
  COUPON_CHECK_METHODS,
} from './enums';

export {
  COUPON_ORIGINS,
  COUPON_STATUSES,
  COUPON_DISCOUNT_TYPES,
  COUPON_CHECK_METHODS,
  type CouponOrigin,
  type CouponStatus,
  type CouponDiscountType,
  type CouponCheckMethod,
} from './enums';

const code = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .transform((s) => s.toUpperCase());

export const couponInputSchema = z.object({
  store: z.enum(MARKETPLACE_KINDS),
  advertiserName: z.string().max(120).nullish(),
  code,
  description: z.string().trim().min(1).max(500),
  terms: z.string().max(2000).nullish(),
  discountType: z.enum(COUPON_DISCOUNT_TYPES).nullish(),
  discountValue: z.number().positive().nullish(),
  minSpend: z.number().nonnegative().nullish(),
  startsAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
  sourceUrl: z.string().url().nullish(),
});
export type CouponInput = z.infer<typeof couponInputSchema>;

export const couponListQuerySchema = z.object({
  store: z.enum(MARKETPLACE_KINDS).optional(),
  status: z.enum(COUPON_STATUSES).optional(),
  origin: z.enum(COUPON_ORIGINS).optional(),
  q: z.string().max(100).optional(),
  includeExpired: z.coerce.boolean().optional(),
});
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;

export const couponVerifySchema = z.object({
  result: z.enum(['VALID', 'INVALID']),
  note: z.string().max(500).optional(),
});
export type CouponVerifyInput = z.infer<typeof couponVerifySchema>;

export const couponParseSchema = z.object({
  text: z.string().min(1).max(20_000),
  store: z.enum(MARKETPLACE_KINDS).optional(),
});
export type CouponParseInput = z.infer<typeof couponParseSchema>;

export const couponBulkSchema = z.object({
  coupons: z.array(couponInputSchema).min(1).max(200),
});
export type CouponBulkInput = z.infer<typeof couponBulkSchema>;
