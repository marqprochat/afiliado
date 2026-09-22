import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import { parseProductUrl, type ParsedProductUrl } from './urls';

export interface StoreLink {
  url: string;
  parsed: Extract<ParsedProductUrl, { source: MarketplaceKind }>;
}

const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;
const TRAILING = /[.,;:!?)\]]+$/;

export function extractStoreLinks(text: string): StoreLink[] {
  const seen = new Set<string>();
  const out: StoreLink[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(TRAILING, '');
    if (seen.has(url)) continue;
    const parsed = parseProductUrl(url);
    if (parsed.source === 'UNSUPPORTED') continue;
    seen.add(url);
    out.push({ url, parsed });
  }
  return out;
}

const TRACKING_PARAMS = new Set(['ref', 'sp_atk', 'xptdk', 'forceInApp']);
function stripTracking(u: URL) {
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) u.searchParams.delete(k);
  }
  u.hash = '';
}

export function buildAffiliateUrl(
  kind: MarketplaceKind,
  url: string,
  creds: TagCredentials,
): string {
  const u = new URL(url);
  stripTracking(u);
  switch (kind) {
    case 'AMAZON': {
      if (!creds.tag) throw new Error('Amazon: tag de afiliado ausente');
      u.pathname = u.pathname.replace(/\/ref=[^/]*$/, '/'); // Amazon usa /ref=... como segmento
      u.searchParams.set('tag', creds.tag);
      return u.toString();
    }
    case 'MERCADOLIVRE': {
      if (!creds.mattWord) throw new Error('Mercado Livre: matt_word ausente');
      if (!creds.mattTool) throw new Error('Mercado Livre: matt_tool ausente');
      u.searchParams.delete('matt_word');
      u.searchParams.delete('matt_tool');
      u.searchParams.set('matt_word', creds.mattWord);
      u.searchParams.set('matt_tool', creds.mattTool);
      return u.toString();
    }
    case 'MAGALU': {
      if (!creds.tag) throw new Error('Magalu: nome da loja ausente');
      const path = u.pathname.replace(/^\/+/, '');
      return new URL(`https://www.magazinevoce.com.br/${creds.tag}/${path}`).toString();
    }
    case 'SHOPEE':
      throw new Error('Shopee usa a API (generateShortLink)');
    case 'AWIN':
      throw new Error('Awin usa o adapter dedicado (toAffiliateLink)');
  }
}

export function rewriteLinks(text: string, replacements: Map<string, string>): string {
  let out = text;
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out;
}

export function productKey(parsed: { source: string; externalId?: string }): string {
  return `${parsed.source}:${parsed.externalId ?? ''}`;
}
