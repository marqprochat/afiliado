import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import { parseProductUrl, type ParsedProductUrl } from './urls';

export interface StoreLink {
  url: string;
  parsed: Extract<ParsedProductUrl, { source: MarketplaceKind }>;
}

const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;
const TRAILING = /[.,;:!?)\]]+$/;

export function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((raw) => raw.replace(TRAILING, ''));
}

export function extractStoreLinks(text: string): StoreLink[] {
  const seen = new Set<string>();
  const out: StoreLink[] = [];
  for (const url of extractUrls(text)) {
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
    case 'ALIEXPRESS':
      throw new Error('AliExpress usa a API dedicada (toAffiliateLink)');
  }
}

export function rewriteLinks(text: string, replacements: Map<string, string>): string {
  let out = text;
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out;
}

function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function productKey(parsed: { source: string; externalId?: string }, url: string): string {
  const id = parsed.externalId ?? hashString(url);
  return `${parsed.source}:${id}`;
}
