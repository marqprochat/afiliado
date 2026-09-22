import { parseProductUrl } from '@afilados/core';
import type { ProductData, SearchQuery, SearchSort } from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter, AliexpressCredentials } from '../adapter';
import { AliexpressClient } from './client';
import { mapAliexpressProduct, type AliexpressRawProduct } from './mapper';

const SORT_MAP: Record<SearchSort, string> = {
  SALES_DESC: 'last_volume_desc',
  COMMISSION_DESC: 'commission_rate_desc',
  PRICE_ASC: 'sale_price_asc',
  PRICE_DESC: 'sale_price_desc',
  DISCOUNT_DESC: 'discount_desc',
};

export interface AliexpressAdapterOptions {
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

export function createAliexpressAdapter(
  opts: AliexpressAdapterOptions = {},
): MarketplaceAdapter<AliexpressCredentials> {
  const getClient = (creds: AliexpressCredentials) =>
    new AliexpressClient(creds, {
      fetchImpl: opts.fetchImpl,
      apiUrl: opts.apiUrl,
    });

  return {
    kind: 'ALIEXPRESS',

    async checkConnection(creds: AliexpressCredentials): Promise<ConnectionStatus> {
      if (!creds.appKey || !creds.appSecret || !creds.trackingId) {
        return { ok: false, error: 'Credenciais incompletas (appKey, appSecret ou trackingId ausente)' };
      }
      try {
        const client = getClient(creds);
        await client.execute('aliexpress.affiliate.link.generate', {
          promotion_link_type: 0,
          source_values: 'https://www.aliexpress.com',
          tracking_id: creds.trackingId,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async search(creds: AliexpressCredentials, query: SearchQuery): Promise<ProductData[]> {
      const client = getClient(creds);
      const sort = query.sort ? SORT_MAP[query.sort] ?? 'last_volume_desc' : 'last_volume_desc';
      const pageSize = query.limit ? Math.min(query.limit, 50) : 20;

      const res = await client.execute<any>('aliexpress.affiliate.product.query', {
        keywords: query.query,
        page_size: pageSize,
        page_no: 1,
        sort,
        target_currency: 'BRL',
        target_language: 'PT',
        tracking_id: creds.trackingId,
      });

      const root = res?.aliexpress_affiliate_product_query_response?.resp_result?.result ?? res?.result ?? res;
      let rawList: AliexpressRawProduct[] = [];

      if (Array.isArray(root?.products)) {
        rawList = root.products;
      } else if (Array.isArray(root?.products?.product)) {
        rawList = root.products.product;
      } else if (Array.isArray(root)) {
        rawList = root;
      }

      return rawList.map(mapAliexpressProduct);
    },

    async fetchByUrls(creds: AliexpressCredentials, urls: string[]): Promise<ProductData[]> {
      const ids: string[] = [];
      for (const u of urls) {
        const parsed = parseProductUrl(u);
        if (parsed.source === 'ALIEXPRESS' && parsed.externalId) {
          ids.push(parsed.externalId);
        }
      }

      if (ids.length === 0) return [];

      const client = getClient(creds);
      const res = await client.execute<any>('aliexpress.affiliate.productdetail.get', {
        product_ids: ids.join(','),
        target_currency: 'BRL',
        target_language: 'PT',
        tracking_id: creds.trackingId,
      });

      const root = res?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result ?? res?.result ?? res;
      let rawList: AliexpressRawProduct[] = [];

      if (Array.isArray(root?.products)) {
        rawList = root.products;
      } else if (Array.isArray(root?.products?.product)) {
        rawList = root.products.product;
      } else if (Array.isArray(root)) {
        rawList = root;
      }

      return rawList.map(mapAliexpressProduct);
    },

    async toAffiliateLink(creds: AliexpressCredentials, url: string, subId?: string): Promise<string> {
      const client = getClient(creds);
      const businessParams: Record<string, unknown> = {
        promotion_link_type: 0,
        source_values: url,
        tracking_id: creds.trackingId,
      };
      if (subId) {
        businessParams.sub_id = subId;
      }

      const res = await client.execute<any>('aliexpress.affiliate.link.generate', businessParams);
      const root = res?.aliexpress_affiliate_link_generate_response?.resp_result?.result ?? res?.result ?? res;

      let links: any[] = [];
      if (Array.isArray(root?.promotion_links)) {
        links = root.promotion_links;
      } else if (Array.isArray(root?.promotion_links?.promotion_link)) {
        links = root.promotion_links.promotion_link;
      }

      const affLink = links[0]?.promotion_link;
      if (typeof affLink === 'string' && affLink.length > 0) {
        return affLink;
      }

      // Fallback para URL original caso a API não retorne link
      return url;
    },
  };
}
