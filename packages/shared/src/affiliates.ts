import { z } from 'zod';

const id = () => z.string().trim().max(60).optional();
export const affiliateSubIdsSchema = z
  .object({
    SHOPEE: id(), ALIEXPRESS: id(), AWIN: id(), AMAZON: id(), MERCADOLIVRE: id(), MAGALU: id(),
  })
  .strict();

export const affiliateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(100).optional(),
  subIds: affiliateSubIdsSchema.optional(),
});
export const affiliateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  subIds: affiliateSubIdsSchema.optional(),
});
export const affiliateActiveSchema = z.object({ active: z.boolean() });
export const affiliateResetPasswordSchema = z.object({ password: z.string().min(8).max(100).optional() });
