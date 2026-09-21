import { buildAffiliateUrl } from '@afilados/core';
import {
  hasTagCredentials,
  requiredTagFields,
  type ProductData,
  type TagCredentials,
} from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';
import { scrapeMagalu, scrapeMercadoLivre } from './scrapers';
import { generateOfficialMlLink } from './mercadolivre/official-link';
import { generateOfficialAmazonLink } from './amazon/official-link';
import {
  extractAsin,
  getItems,
  mapCreatorsApiItem,
  type AmazonApiCredentials,
  type AmazonApiItem,
} from './amazon/creators-api';

export class UnsupportedError extends Error {
  constructor(message = 'operação não suportada') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

/** ASIN estável só para o teste mínimo de credenciais em checkConnection; o conteúdo não importa. */
const AMAZON_CHECK_CONNECTION_ASIN = 'B08N5WRWNW';

export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';

export interface TagAdapterOptions {
  /** Gerador do link oficial meli.la (injetável em testes). */
  mlOfficialLink?: (url: string, cookies: Record<string, string>) => Promise<string>;
  /** Gerador do link oficial SiteStripe da Amazon (injetável em testes). */
  amazonOfficialLink?: (
    url: string,
    cookies: Record<string, string>,
    storeId: string,
  ) => Promise<string>;
  /** Chamado quando o gerador oficial falha e caímos no fallback matt_word/matt_tool ou tag. */
  onOfficialLinkError?: (err: unknown, url: string) => void;
  /** Chamador do GetItems da Creators API (injetável em testes). */
  amazonGetItems?: (asins: string[], creds: AmazonApiCredentials) => Promise<AmazonApiItem[]>;
}

/** Cache curto de links oficiais para não bater no painel/SiteStripe a cada envio. */
const officialLinkCache = new Map<string, { link: string; expiresAt: number }>();
const OFFICIAL_LINK_TTL_MS = 60 * 60 * 1000;

async function fetchAmazonByUrls(
  creds: TagCredentials,
  urls: string[],
  amazonGetItems: (asins: string[], creds: AmazonApiCredentials) => Promise<AmazonApiItem[]>,
): Promise<ProductData[]> {
  const partnerTag = creds.tag;
  const clientId = creds.amazonApi?.clientId;
  const clientSecret = creds.amazonApi?.clientSecret;
  if (!partnerTag || !clientId || !clientSecret) return [];

  const urlByAsin = new Map<string, string>();
  for (const url of urls) {
    const asin = extractAsin(url);
    if (asin) urlByAsin.set(asin, url);
  }
  const asins = [...urlByAsin.keys()];
  if (asins.length === 0) return [];

  let items: AmazonApiItem[];
  try {
    items = await amazonGetItems(asins, { clientId, clientSecret, partnerTag });
  } catch {
    // Sem fallback para scraping (decisão de design): a chamada falhou, nenhum produto Amazon
    // deste lote é retornado — quem chamou trata a lista vazia como "nada encontrado".
    return [];
  }

  const results: ProductData[] = [];
  for (const item of items) {
    const url = urlByAsin.get(item.asin);
    if (url) results.push(mapCreatorsApiItem(item, url));
  }
  return results;
}

export function createTagAdapter(
  kind: TagKind,
  opts: TagAdapterOptions = {},
): MarketplaceAdapter<TagCredentials> {
  const officialLink =
    opts.mlOfficialLink ?? ((url, cookies) => generateOfficialMlLink(url, cookies));
  const amazonOfficialLink =
    opts.amazonOfficialLink ??
    ((url, cookies, storeId) => generateOfficialAmazonLink(url, cookies, storeId));
  const amazonGetItems = opts.amazonGetItems ?? getItems;
  return {
    kind,
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (kind === 'AMAZON' && creds?.amazonApi?.clientId && creds?.amazonApi?.clientSecret) {
        try {
          await amazonGetItems([AMAZON_CHECK_CONNECTION_ASIN], {
            clientId: creds.amazonApi.clientId,
            clientSecret: creds.amazonApi.clientSecret,
            partnerTag: creds.tag ?? '',
          });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (kind === 'AMAZON' && creds?.amazonSession?.cookies) {
        const storeId = creds.tag ?? '';
        try {
          await amazonOfficialLink('https://www.amazon.com.br/', creds.amazonSession.cookies, storeId);
          return { ok: true };
        } catch (err) {
          if (hasTagCredentials(kind, creds)) return { ok: true };
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (hasTagCredentials(kind, creds)) return { ok: true };
      // ML com sessão sincronizada consegue gerar o link oficial mesmo sem matt_word/matt_tool
      if (kind === 'MERCADOLIVRE' && creds?.mlSession?.cookies) return { ok: true };
      return { ok: false, error: `Informe: ${requiredTagFields(kind).join(', ')}` };
    },
    async fetchByUrls(creds, urls: string[]): Promise<ProductData[]> {
      if (kind === 'AMAZON') {
        return fetchAmazonByUrls(creds, urls, amazonGetItems);
      }
      const results: ProductData[] = [];
      for (const url of urls) {
        try {
          const product =
            kind === 'MERCADOLIVRE' ? await scrapeMercadoLivre(url) : await scrapeMagalu(url);
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
        const cacheKey = `MERCADOLIVRE:${url}`;
        const cached = officialLinkCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.link;
        try {
          const link = await officialLink(url, creds.mlSession.cookies);
          officialLinkCache.set(cacheKey, { link, expiresAt: Date.now() + OFFICIAL_LINK_TTL_MS });
          return link;
        } catch (err) {
          opts.onOfficialLinkError?.(err, url);
          if (!hasTagCredentials(kind, creds)) throw err;
        }
      }
      // Amazon: link curto oficial via SiteStripe (sessão), com fallback para link por tag
      if (kind === 'AMAZON' && creds.amazonSession?.cookies) {
        const cacheKey = `AMAZON:${url}`;
        const cached = officialLinkCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.link;
        try {
          const link = await amazonOfficialLink(url, creds.amazonSession.cookies, creds.tag ?? '');
          officialLinkCache.set(cacheKey, { link, expiresAt: Date.now() + OFFICIAL_LINK_TTL_MS });
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
