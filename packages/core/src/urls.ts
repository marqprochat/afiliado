import type { MarketplaceKind } from '@afilados/shared';

export type ParsedProductUrl =
  | { source: MarketplaceKind; externalId: string; shopId?: string }
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
    const m = path.match(/MLB-?(\d+)/);
    if (m) return { source: 'MERCADOLIVRE', externalId: `MLB${m[1]}` };
  }
  if (host === 'amazon.com.br') {
    const m = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (m) return { source: 'AMAZON', externalId: m[1]! };
  }
  if (host === 'magazineluiza.com.br') {
    const m = path.match(/\/p\/([a-z0-9]+)\//);
    if (m) return { source: 'MAGALU', externalId: m[1]! };
  }
  return { source: 'UNSUPPORTED', reason: `Domínio ou formato não reconhecido: ${host}${path}` };
}
