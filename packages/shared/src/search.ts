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

/** Fontes da busca por listagem do Mercado Livre (ofertas do dia, categoria, relâmpago). */
export const ML_LISTING_KINDS = ['deals', 'category', 'lightning'] as const;
export type MlListingKind = (typeof ML_LISTING_KINDS)[number];

const mlListingSchema = z.object({
  kind: z.enum(ML_LISTING_KINDS),
  categoryId: z
    .string()
    .regex(/^MLB\d+$/, 'Categoria inválida')
    .optional(),
});
export type MlListingQuery = z.infer<typeof mlListingSchema>;

/** Fontes da busca por listagem da Amazon: ofertas por palavra-chave e a página Mega Oferta Prime. */
export const AMAZON_LISTING_KINDS = ['deals', 'mega'] as const;
export type AmazonListingKind = (typeof AMAZON_LISTING_KINDS)[number];

const amazonListingSchema = z.object({ kind: z.enum(AMAZON_LISTING_KINDS) });
export type AmazonListingQuery = z.infer<typeof amazonListingSchema>;

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Filtro por palavra-chave sobre o título de um produto: todas as palavras da consulta precisam
 * aparecer, em qualquer ordem, ignorando acentos e maiúsculas. Consulta vazia aceita qualquer título.
 * Usado pelas listagens do Mercado Livre, que não têm busca por palavra-chave própria.
 */
export function matchesSearchKeywords(title: string, query: string): boolean {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const normalizedTitle = normalizeSearchText(title);
  return tokens.every((token) => normalizedTitle.includes(token));
}

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
    amazonListing: amazonListingSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.mode === 'keyword' && !q.query)
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query obrigatória' });
    if (q.mode === 'category' && !q.categoryId)
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'categoryId obrigatório' });
    if (q.mode === 'shop' && !q.shopId)
      ctx.addIssue({ code: 'custom', path: ['shopId'], message: 'shopId obrigatório' });
    if (q.mode === 'listing') {
      if (q.source !== 'MERCADOLIVRE' && q.source !== 'AMAZON') {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'A busca por listagem só existe para o Mercado Livre e a Amazon',
        });
      } else if (q.source === 'AMAZON') {
        if (!q.amazonListing) {
          ctx.addIssue({
            code: 'custom',
            path: ['amazonListing'],
            message: 'amazonListing obrigatório',
          });
        } else if (q.amazonListing.kind === 'deals' && !q.query) {
          ctx.addIssue({ code: 'custom', path: ['query'], message: 'query obrigatória' });
        }
      } else if (!q.mlListing) {
        ctx.addIssue({ code: 'custom', path: ['mlListing'], message: 'mlListing obrigatório' });
      } else if (q.mlListing.kind === 'category' && !q.mlListing.categoryId) {
        ctx.addIssue({
          code: 'custom',
          path: ['mlListing', 'categoryId'],
          message: 'categoryId obrigatório',
        });
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
