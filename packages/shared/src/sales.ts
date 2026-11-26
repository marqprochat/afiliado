import { z } from 'zod';

/** Chave em `Setting` com o segredo da URL do webhook de transações da Awin. */
export const AWIN_WEBHOOK_TOKEN_KEY = 'awinWebhookToken';

export const AFFILIATE_SALE_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'DELETED'] as const;
export type AffiliateSaleStatus = (typeof AFFILIATE_SALE_STATUSES)[number];

export const SALES_DEFAULT_RANGE_DAYS = 30;
export const SALES_MAX_RANGE_DAYS = 366;
export const SALES_PAGE_SIZE = 20;
const DAY_MS = 86_400_000;

const rawSalesQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  status: z.enum(AFFILIATE_SALE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** `from` inclusivo, `to` exclusivo. */
export interface SalesQuery {
  from: Date;
  to: Date;
  status?: AffiliateSaleStatus;
  page: number;
}

/** Valida a query de vendas; sem datas = últimos 30 dias até agora. ZodError em entrada inválida. */
export function parseSalesQuery(input: unknown, now: Date = new Date()): SalesQuery {
  const v = rawSalesQuerySchema.parse(input ?? {});
  const to = v.to ? new Date(v.to) : now;
  const from = v.from
    ? new Date(v.from)
    : new Date(to.getTime() - SALES_DEFAULT_RANGE_DAYS * DAY_MS);
  const issues: z.ZodIssue[] = [];
  if (to.getTime() <= from.getTime()) {
    issues.push({ code: 'custom', message: 'to deve ser posterior a from', path: ['to'] });
  } else if (to.getTime() - from.getTime() > SALES_MAX_RANGE_DAYS * DAY_MS) {
    issues.push({
      code: 'custom',
      message: `intervalo máximo de ${SALES_MAX_RANGE_DAYS} dias`,
      path: ['to'],
    });
  }
  if (issues.length) throw new z.ZodError(issues);
  return { from, to, page: v.page ?? 1, ...(v.status ? { status: v.status } : {}) };
}

export type SaleChannelKind = 'WHATSAPP' | 'TELEGRAM';

export interface SalesChannelRow {
  /** null = vendas/cliques sem canal identificado */
  channelId: string | null;
  channelKind: SaleChannelKind | null;
  channelName: string;
  trackCode: string | null;
  clicks: number;
  sales: number;
  commissionPending: number;
  commissionApproved: number;
  /** vendas ÷ cliques (0–1); null sem cliques */
  conversion: number | null;
}

export interface SalesAdvertiserRow {
  advertiserId: string;
  advertiserName: string | null;
  sales: number;
  saleAmount: number;
  commissionPending: number;
  commissionApproved: number;
}

export interface SalesDailyPoint {
  /** `YYYY-MM-DD` no fuso de São Paulo */
  date: string;
  sales: number;
  commission: number;
}

export interface SalesSummary {
  from: string;
  to: string;
  /** Moedas presentes no período (normalmente só BRL). */
  currencies: string[];
  totals: {
    commissionApproved: number;
    commissionPending: number;
    /** vendas pendentes + aprovadas (recusadas/excluídas ficam fora) */
    sales: number;
    declined: number;
    clicks: number;
    conversion: number | null;
  };
  byChannel: SalesChannelRow[];
  byAdvertiser: SalesAdvertiserRow[];
  daily: SalesDailyPoint[];
}

export interface SaleListItem {
  id: string;
  externalId: string;
  advertiserId: string;
  advertiserName: string | null;
  saleAmount: number;
  commissionAmount: number;
  currency: string;
  status: AffiliateSaleStatus;
  transactionDate: string;
  validationDate: string | null;
  channelKind: SaleChannelKind | null;
  channelName: string | null;
  source: 'API' | 'WEBHOOK';
}

export interface SalesList {
  items: SaleListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AwinWebhookInfo {
  url: string;
  path: string;
}
