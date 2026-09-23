import { parseProductUrl } from '@afilados/core';
import type { ProductData, SearchQuery, SearchSort } from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter, AliexpressCredentials } from '../adapter';
import { AliexpressClient } from './client';
import { mapAliexpressProduct, type AliexpressRawProduct } from './mapper';

// A API de afiliados do AliExpress só reconhece os sorts documentados; um valor fora da lista
// não dá erro — ela simplesmente ignora a ordenação E o ranking de relevância da keyword,
// devolvendo um recorte solto do match amplo (busca por "notebook" retornando estojos, caixas e
// cadernos, porque o termo também é traduzido). Validado contra a API real: 'discount_desc' e
// 'commission_rate_desc' devolvem exatamente o mesmo conjunto que um sort inventado — só
// last_volume_desc e sale_price_asc/desc são realmente aceitos. Por isso "maior desconto" e
// "maior comissão" caem no padrão last_volume_desc (mais vendidos), que preserva a relevância;
// desconto mínimo e comissão continuam sendo aplicados nos filtros locais.
const SORT_MAP: Record<SearchSort, string> = {
  SALES_DESC: 'last_volume_desc',
  COMMISSION_DESC: 'last_volume_desc',
  PRICE_ASC: 'sale_price_asc',
  PRICE_DESC: 'sale_price_desc',
  DISCOUNT_DESC: 'last_volume_desc',
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

      const method =
        query.mode === 'trending'
          ? 'aliexpress.affiliate.hotproduct.query'
          : 'aliexpress.affiliate.product.query';

      const businessParams: Record<string, unknown> = {
        page_size: pageSize,
        page_no: 1,
        sort,
        target_currency: 'BRL',
        target_language: 'PT',
        tracking_id: creds.trackingId,
      };

      if (query.query) {
        businessParams.keywords = query.query;
      }
      if (query.categoryId) {
        businessParams.category_ids = query.categoryId;
      }

      const res = await client.execute<any>(method, businessParams);
      const root = extractAliResult(res);
      const rawList: AliexpressRawProduct[] = extractArray(root, 'products');

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

      const root = extractAliResult(res);
      const rawList: AliexpressRawProduct[] = extractArray(root, 'products');

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
      const root = extractAliResult(res);
      const links = extractArray(root, 'promotion_links');

      const affLink = links[0]?.promotion_link;
      if (typeof affLink === 'string' && affLink.length > 0) {
        return affLink;
      }

      // Fallback para URL original caso a API não retorne link
      return url;
    },
  };
}

function extractAliResult(res: any): any {
  if (!res) return null;
  for (const key of Object.keys(res)) {
    if (key.endsWith('_response') && res[key]?.resp_result?.result !== undefined) {
      return res[key].resp_result.result;
    }
    if (key.endsWith('_response') && res[key]?.result !== undefined) {
      return res[key].result;
    }
  }
  if (res?.resp_result?.result !== undefined) {
    return res.resp_result.result;
  }
  if (res?.result !== undefined) {
    return res.result;
  }
  return res;
}

function extractArray(obj: any, key: string): any[] {
  if (!obj) return [];
  const val = obj[key];
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') {
    const innerKey = key.endsWith('s') ? key.slice(0, -1) : key;
    if (Array.isArray(val[innerKey])) return val[innerKey];
    for (const k of Object.keys(val)) {
      if (Array.isArray(val[k])) return val[k];
    }
  }
  if (Array.isArray(obj)) return obj;
  return [];
}
