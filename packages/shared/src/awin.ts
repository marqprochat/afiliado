import { z } from 'zod';
import type { ProductData } from './product';

export interface AwinCatalogRow {
  feedId: string;
  externalId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  deepLink: string;
  raw: unknown;
  /** Nome da loja no feed; vira `shopName` (usado no ranking por EPC e no filtro da lista). */
  advertiserName?: string | null;
}

export function mapAwinCatalogRowToProductData(row: AwinCatalogRow): ProductData {
  return {
    source: 'AWIN',
    // aw_product_id só é único dentro do feed de um anunciante — namespaceamos por feedId para
    // não colidir com o mesmo externalId vindo de outro anunciante/feed.
    externalId: `${row.feedId}:${row.externalId}`,
    title: row.title,
    price: row.price,
    ...(row.originalPrice !== null ? { originalPrice: row.originalPrice } : {}),
    images: row.imageUrl ? [row.imageUrl] : [],
    shipping: 'UNKNOWN',
    originalUrl: row.deepLink,
    ...(row.advertiserName?.trim() ? { shopName: row.advertiserName.trim() } : {}),
    raw: row.raw,
  };
}

/** Indicadores de um programa Awin como a API devolve (ordenados por score). */
export interface AwinProgrammeStatsItem {
  advertiserId: string;
  name: string;
  logoUrl: string | null;
  displayUrl: string | null;
  currency: string | null;
  epc: number | null;
  conversionRate: number | null;
  approvalPercentage: number | null;
  averagePaymentTime: number | null;
  validationDays: number | null;
  awinIndex: number | null;
  commissionMin: number | null;
  commissionMax: number | null;
  commissionType: string | null;
  score: number | null;
  fetchedAt: string;
}

/** Loja do catálogo Awin no seletor da busca (ordenada pelo score do programa). */
export interface AwinStoreOption {
  name: string;
  advertiserId: string | null;
  epc: number | null;
  currency: string | null;
  score: number | null;
}

/** Conversão de links da Awin em lote (`POST /marketplaces/awin/links/batch`). */
export const awinLinksBatchSchema = z.object({
  items: z
    .array(
      z.object({
        url: z.string().trim().url().max(4000),
        subId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,50}$/, 'subId: só letras, números, _ e -, até 50')
          .optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type AwinLinksBatchBody = z.infer<typeof awinLinksBatchSchema>;

export interface AwinLinksBatchItem {
  input: string;
  /** Link de rastreio; `null` quando o site não é parceiro (ver `error`). */
  url: string | null;
  source?: 'api' | 'canonical';
  error?: string;
}

export const awinShortLinksSchema = z.object({ enabled: z.boolean() });

/** `GET /marketplaces/awin/links/quota`. */
export interface AwinLinkQuotaResponse {
  /** Setting `awinShortLinks`. */
  enabled: boolean;
  /** Há Publisher ID e token para consultar a cota. */
  available: boolean;
  quota: { limit: number | null; usage: number; remaining: number | null } | null;
  error?: string;
}
