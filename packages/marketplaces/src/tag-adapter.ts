import { buildAffiliateUrl } from '@afilados/core';
import {
  hasTagCredentials,
  requiredTagFields,
  type ProductData,
  type TagCredentials,
} from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';
import { scrapeAmazon, scrapeMagalu, scrapeMercadoLivre } from './scrapers';
import { generateOfficialMlLink } from './mercadolivre/official-link';

export class UnsupportedError extends Error {
  constructor(message = 'operação não suportada') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';

export interface TagAdapterOptions {
  /** Gerador do link oficial meli.la (injetável em testes). */
  mlOfficialLink?: (url: string, cookies: Record<string, string>) => Promise<string>;
  /** Chamado quando o gerador oficial falha e caímos no fallback matt_word/matt_tool. */
  onOfficialLinkError?: (err: unknown, url: string) => void;
}

/** Cache curto de links oficiais para não bater no painel do ML a cada envio. */
const officialLinkCache = new Map<string, { link: string; expiresAt: number }>();
const OFFICIAL_LINK_TTL_MS = 60 * 60 * 1000;

export function createTagAdapter(
  kind: TagKind,
  opts: TagAdapterOptions = {},
): MarketplaceAdapter<TagCredentials> {
  const officialLink =
    opts.mlOfficialLink ?? ((url, cookies) => generateOfficialMlLink(url, cookies));
  return {
    kind,
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (hasTagCredentials(kind, creds)) return { ok: true };
      // ML com sessão sincronizada consegue gerar o link oficial mesmo sem matt_word/matt_tool
      if (kind === 'MERCADOLIVRE' && creds?.mlSession?.cookies) return { ok: true };
      return { ok: false, error: `Informe: ${requiredTagFields(kind).join(', ')}` };
    },
    async fetchByUrls(creds, urls: string[]): Promise<ProductData[]> {
      const results: ProductData[] = [];
      for (const url of urls) {
        try {
          let product: ProductData;
          if (kind === 'MERCADOLIVRE') {
            product = await scrapeMercadoLivre(url);
          } else if (kind === 'AMAZON') {
            product = await scrapeAmazon(url);
          } else {
            product = await scrapeMagalu(url);
          }
          results.push(product);
        } catch {
          // Se falhar em uma URL, continua para as próximas
        }
      }
      return results;
    },
    async toAffiliateLink(creds, url) {
      // Mercado Livre: gerador oficial (meli.la) via sessão sincronizada, com fallback para tags
      if (kind === 'MERCADOLIVRE' && creds.mlSession?.cookies) {
        const cached = officialLinkCache.get(url);
        if (cached && cached.expiresAt > Date.now()) return cached.link;
        try {
          const link = await officialLink(url, creds.mlSession.cookies);
          officialLinkCache.set(url, { link, expiresAt: Date.now() + OFFICIAL_LINK_TTL_MS });
          return link;
        } catch (err) {
          opts.onOfficialLinkError?.(err, url);
          if (!hasTagCredentials(kind, creds)) throw err;
        }
      }
      return buildAffiliateUrl(kind, url, creds);
    },
  };
}
