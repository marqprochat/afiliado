import pino from 'pino';
import {
  extractUrls,
  parseProductUrl,
  resolveShortLinks as resolveShortLinksImpl,
  rewriteLinks,
} from '@afilados/core';
import { forTenant } from '@afilados/db';
import type { ProductData, ProductEnrichJob } from '@afilados/shared';
import { fetchProductWithCache } from '../processors/product-enrich';
import { isSiteLinksEnabled, publishOfferForTenant, type PublishOfferFn } from './publish-offer';

const log = pino({ name: 'rewrite-offer-links' });

/** Teto de URLs de loja tratadas por mensagem (cada uma busca o produto e indexa). */
export const MAX_OFFER_LINKS = 5;

type FetchKind = ProductEnrichJob['marketplaceKind'];

/** Lojas com fetcher por URL; a Awin não tem (fetchByUrls devolve []). */
const FETCHABLE: ReadonlySet<string> = new Set<FetchKind>([
  'SHOPEE',
  'MERCADOLIVRE',
  'AMAZON',
  'MAGALU',
  'ALIEXPRESS',
]);

export interface RewriteOfferLinksCtx {
  tenantId: string;
  /** URL do texto → link original do produto, quando o chamador já o conhece (espelhamento). */
  knownOriginals?: Map<string, string>;
  isEnabled?: (tenantId: string) => Promise<boolean>;
  resolveShortLinks?: (text: string) => Promise<Map<string, string>>;
  fetchProduct?: (tenantId: string, kind: FetchKind, url: string) => Promise<ProductData | null>;
  publish?: PublishOfferFn;
}

export type RewriteOfferLinksFn = (
  tenantId: string,
  text: string,
  knownOriginals?: Map<string, string>,
) => Promise<string>;

/**
 * Troca cada URL de loja do texto (já convertida para afiliado) pelo link da página da oferta no
 * site. URL que não é de loja, loja sem fetcher, busca que falha ou publicação que devolve `null`
 * mantém o link de afiliado.
 */
export async function rewriteOfferLinks(text: string, ctx: RewriteOfferLinksCtx): Promise<string> {
  const isEnabled = ctx.isEnabled ?? ((t: string) => isSiteLinksEnabled(forTenant(t)));
  if (!(await isEnabled(ctx.tenantId).catch(() => false))) return text;

  const urls = [...new Set(extractUrls(text))];
  if (urls.length === 0) return text;

  const known = ctx.knownOriginals ?? new Map<string, string>();
  const resolve = ctx.resolveShortLinks ?? ((t: string) => resolveShortLinksImpl(t));
  const expansions = urls.every((u) => known.has(u))
    ? new Map<string, string>()
    : await resolve(text).catch(() => new Map<string, string>());
  const fetchProduct = ctx.fetchProduct ?? fetchProductWithCache;
  const publish = ctx.publish ?? publishOfferForTenant;

  const replacements = new Map<string, string>();
  let processed = 0;
  for (const url of urls) {
    if (processed >= MAX_OFFER_LINKS) break;
    const original = known.get(url) ?? expansions.get(url) ?? url;
    const parsed = parseProductUrl(original);
    if (parsed.source === 'UNSUPPORTED' || !FETCHABLE.has(parsed.source)) continue;
    processed++;
    try {
      const product = await fetchProduct(ctx.tenantId, parsed.source as FetchKind, original);
      if (!product) continue;
      const siteUrl = await publish(ctx.tenantId, product, url);
      if (siteUrl) replacements.set(url, siteUrl);
    } catch (err) {
      log.warn(
        { tenantId: ctx.tenantId, url, err: err instanceof Error ? err.message : String(err) },
        'não foi possível montar a página da oferta; mantendo o link de afiliado',
      );
    }
  }
  return replacements.size > 0 ? rewriteLinks(text, replacements) : text;
}

export const rewriteOfferLinksForTenant: RewriteOfferLinksFn = (tenantId, text, knownOriginals) =>
  rewriteOfferLinks(text, { tenantId, ...(knownOriginals ? { knownOriginals } : {}) });
