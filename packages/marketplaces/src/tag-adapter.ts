import { buildAffiliateUrl } from '@afilados/core';
import { hasTagCredentials, requiredTagFields, type ProductData, type TagCredentials } from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';
import { scrapeAmazon, scrapeMagalu, scrapeMercadoLivre } from './scrapers';

export class UnsupportedError extends Error {
  constructor(message = 'operação não suportada') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';

export function createTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return {
    kind,
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (hasTagCredentials(kind, creds)) return { ok: true };
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
      return buildAffiliateUrl(kind, url, creds);
    },
  };
}
