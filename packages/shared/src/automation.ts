import { z } from 'zod';
import { MARKETPLACE_KINDS, MEDIA_MODES } from './enums';

export const automationRuleCreateSchema = z.object({
  name: z.string().min(1).max(80),
  marketplaces: z.array(z.enum(MARKETPLACE_KINDS)).min(1),
  keywords: z.array(z.string().min(1)).min(1),
  blockedKeywords: z.array(z.string().min(1)).default([]),
  minDiscountPct: z.number().int().min(0).max(100).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  maxOffersPerDay: z.number().int().min(1).max(200).default(20),
  intervalMin: z.number().int().min(5).max(1440).default(60),
  sessionId: z.string().min(1),
  groupJids: z.array(z.string().min(1)).min(1),
  telegramChatIds: z.array(z.string().min(1)).default([]),
  templateId: z.string().min(1),
  mediaMode: z.enum(MEDIA_MODES).default('IMAGE'),
});
export type AutomationRuleCreateBody = z.infer<typeof automationRuleCreateSchema>;

export const automationRuleUpdateSchema = automationRuleCreateSchema.partial();
export type AutomationRuleUpdateBody = z.infer<typeof automationRuleUpdateSchema>;

export const automationQueueLinkSchema = z.object({ url: z.string().min(1).url() });
export type AutomationQueueLinkBody = z.infer<typeof automationQueueLinkSchema>;

export const automationQueueCouponSchema = z
  .object({
    templateId: z.string().min(1),
    couponId: z.string().min(1).optional(),
    coupon: z
      .object({
        store: z.enum(MARKETPLACE_KINDS),
        code: z.string().min(1),
        description: z.string().min(1),
        expiresAt: z.string().datetime().optional(),
        sourceUrl: z.string().url().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.couponId && !v.coupon) {
      ctx.addIssue({
        code: 'custom',
        path: ['couponId'],
        message: 'informe couponId ou os dados de um cupom novo',
      });
    }
  });
export type AutomationQueueCouponBody = z.infer<typeof automationQueueCouponSchema>;
