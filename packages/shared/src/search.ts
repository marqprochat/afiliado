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

export const SEARCH_MODES = ['keyword', 'category', 'trending', 'shop', 'listing'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Fontes da busca por listagem do Mercado Livre (ofertas do dia, categoria, relâmpago, URL colada). */
export const ML_LISTING_KINDS = ['deals', 'category', 'lightning', 'url'] as const;
export type MlListingKind = (typeof ML_LISTING_KINDS)[number];

const mlListingSchema = z.object({
  kind: z.enum(ML_LISTING_KINDS),
  categoryId: z
    .string()
    .regex(/^MLB\d+$/, 'Categoria inválida')
    .optional(),
  url: z.string().url().max(2000).optional(),
});
export type MlListingQuery = z.infer<typeof mlListingSchema>;

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
    mlListing: mlListingSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.mode === 'keyword' && !q.query)
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query obrigatória' });
    if (q.mode === 'category' && !q.categoryId)
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'categoryId obrigatório' });
    if (q.mode === 'shop' && !q.shopId)
      ctx.addIssue({ code: 'custom', path: ['shopId'], message: 'shopId obrigatório' });
    if (q.mode === 'listing') {
      if (q.source !== 'MERCADOLIVRE') {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'A busca por listagem só existe para o Mercado Livre',
        });
      }
      if (!q.mlListing) {
        ctx.addIssue({ code: 'custom', path: ['mlListing'], message: 'mlListing obrigatório' });
      } else {
        if (q.mlListing.kind === 'category' && !q.mlListing.categoryId)
          ctx.addIssue({
            code: 'custom',
            path: ['mlListing', 'categoryId'],
            message: 'categoryId obrigatório',
          });
        if (q.mlListing.kind === 'url' && !q.mlListing.url)
          ctx.addIssue({ code: 'custom', path: ['mlListing', 'url'], message: 'url obrigatória' });
      }
    }
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxPrice'],
        message: 'Preço máximo deve ser maior que o mínimo',
      });
    }
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;
