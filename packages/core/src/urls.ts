import type { MarketplaceKind } from '@afilados/shared';

export type ParsedProductUrl =
  | { source: MarketplaceKind; externalId?: string; shopId?: string; advertiserId?: string }
  | { source: 'UNSUPPORTED'; reason: string };

export interface ParseProductUrlOptions {
  awinPartners?: Record<string, { advertiserId?: string }> | Set<string> | string[];
}

export function parseProductUrl(
  raw: string,
  options?: ParseProductUrlOptions,
): ParsedProductUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { source: 'UNSUPPORTED', reason: 'URL inválida' };
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;

  if (host === 'shopee.com.br') {
    const m1 = path.match(/-i\.(\d+)\.(\d+)/);
    if (m1) return { source: 'SHOPEE', shopId: m1[1]!, externalId: m1[2]! };
    // /opaanlp/ é o destino do redirect de s.shopee.com.br para clientes sem JS/mobile.
    const m2 = path.match(/^\/(?:product|opaanlp)\/(\d+)\/(\d+)/);
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
  if (host === 'aliexpress.com' || host.endsWith('.aliexpress.com')) {
    const m = path.match(/\/item\/(\d+)/i) || path.match(/_p(\d+)/i);
    if (m) return { source: 'ALIEXPRESS', externalId: m[1]! };
    return { source: 'ALIEXPRESS' };
  }

  // Verifica se é um domínio de parceiro da Awin
  if (options?.awinPartners) {
    if (Array.isArray(options.awinPartners) && options.awinPartners.includes(host)) {
      return { source: 'AWIN' };
    }
    if (options.awinPartners instanceof Set && options.awinPartners.has(host)) {
      return { source: 'AWIN' };
    }
    if (typeof options.awinPartners === 'object' && !(options.awinPartners instanceof Set)) {
      const partner = (options.awinPartners as Record<string, { advertiserId?: string }>)[host];
      if (partner) {
        return partner.advertiserId
          ? { source: 'AWIN', advertiserId: partner.advertiserId }
          : { source: 'AWIN' };
      }
    }
  }

  // Fallback para parceiros Awin populares (ex: drogal.com.br)
  if (host === 'drogal.com.br' || host.endsWith('.drogal.com.br')) {
    return { source: 'AWIN', advertiserId: '68224' };
  }

  return { source: 'UNSUPPORTED', reason: `Domínio ou formato não reconhecido: ${host}${path}` };
}
