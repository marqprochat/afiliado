import { z } from 'zod';
import { MARKETPLACE_KINDS } from './enums';

export const SEARCH_SORTS = [
  'DISCOUNT_DESC',
  'COMMISSION_DESC',
  'SALES_DESC',
  'PRICE_ASC',
  'PRICE_DESC',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_MODES = ['keyword', 'category', 'trending', 'shop'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const searchQuerySchema = z
  .object({
    source: z.enum(MARKETPLACE_KINDS),
    mode: z.enum(SEARCH_MODES),
    query: z.string().trim().min(1).optional(),
    categoryId: z.string().optional(),
    shopId: z.string().optional(),
    sort: z.enum(SEARCH_SORTS).default('DISCOUNT_DESC'),
    limit: z.number().int().min(1).max(500).default(100),
    topSellers: z.boolean().default(false),
    extraCommission: z.boolean().default(false),
    // Filtros aplicados no backend após a busca em qualquer marketplace (ver
    // apps/api/src/routes/products.ts), já que nem toda API de origem tem filtro nativo de preço
    // (a Shopee não tem; o AliExpress tem e recebe esses valores direto na query).
    minPrice: z.number().nonnegative().optional(),
    maxPrice: z.number().positive().optional(),
    minDiscountPct: z.number().int().min(1).max(99).optional(),
    minSales: z.number().int().nonnegative().optional(),
    freeShippingOnly: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.mode === 'keyword' && !q.query)
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query obrigatória' });
    if (q.mode === 'category' && !q.categoryId)
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'categoryId obrigatório' });
    if (q.mode === 'shop' && !q.shopId)
      ctx.addIssue({ code: 'custom', path: ['shopId'], message: 'shopId obrigatório' });
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxPrice'],
        message: 'Preço máximo deve ser maior que o mínimo',
      });
    }
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;
