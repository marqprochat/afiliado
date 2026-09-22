import type { MarketplaceKind } from '@afilados/shared';

export type ParsedProductUrl =
  | { source: MarketplaceKind; externalId?: string; shopId?: string }
  | { source: 'UNSUPPORTED'; reason: string };

export function parseProductUrl(raw: string): ParsedProductUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { source: 'UNSUPPORTED', reason: 'URL inválida' };
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname;

  if (host === 'shopee.com.br') {
    const m1 = path.match(/-i\.(\d+)\.(\d+)/);
    if (m1) return { source: 'SHOPEE', shopId: m1[1]!, externalId: m1[2]! };
    const m2 = path.match(/^\/product\/(\d+)\/(\d+)/);
    if (m2) return { source: 'SHOPEE', shopId: m2[1]!, externalId: m2[2]! };
  }
  if (host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br')) {
    const m = path.match(/MLB-?(\d+)/i) || path.match(/\/p\/(MLB\d+|[A-Z0-9]+)/i);
    if (m) {
      const digits = m[1]!.replace(/^MLB-?/i, '');
      return { source: 'MERCADOLIVRE', externalId: `MLB${digits}` };
    }
  }
  if (host === 'amazon.com.br') {
    const m = path.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/);
    if (m) return { source: 'AMAZON', externalId: m[1]!.toUpperCase() };
  }
  if (
    host === 'magazineluiza.com.br' ||
    host === 'magazinevoce.com.br' ||
    host.endsWith('.magazinevoce.com.br')
  ) {
    const m = path.match(/\/p\/([a-z0-9]+)/i) || path.match(/\/([a-z0-9]{7,12})\//i);
    if (m) return { source: 'MAGALU', externalId: m[1]! };
  }
  if (host === 'awin1.com') {
    // O deep link da Awin não expõe um id de produto recuperável — awinmid é o id do
    // anunciante, não do produto. Sem externalId, upsertProducts cai no fallback de
    // sha1(originalUrl) para deduplicar.
    return { source: 'AWIN' };
  }
  return { source: 'UNSUPPORTED', reason: `Domínio ou formato não reconhecido: ${host}${path}` };
}
