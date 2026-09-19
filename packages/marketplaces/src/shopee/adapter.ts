import { parseProductUrl } from '@afilados/core';
import type { ProductData, SearchQuery, SearchSort } from '@afilados/shared';
import type { MarketplaceAdapter, ShopeeCredentials, ConnectionStatus } from '../adapter';
import { ShopeeGraphQLClient } from './client';
import { mapProductOffer, type ShopeeProductOfferNode } from './mapper';
import offersFixture from './fixtures/productOfferV2.json';
import shortLinkFixture from './fixtures/generateShortLink.json';

// sortType da Open Platform: 1 = relevância, 2 = mais vendidos, 3 = maior comissão,
// 4 = preço asc, 5 = preço desc, 6 = maior desconto
const SORT_MAP: Record<SearchSort, number> = {
  SALES_DESC: 2,
  COMMISSION_DESC: 3,
  PRICE_ASC: 4,
  PRICE_DESC: 5,
  DISCOUNT_DESC: 6,
};

// TODO(F1-B): usar o filtro hasExtraCommission da API em vez de heurística local
const EXTRA_COMMISSION_MIN_PCT = 3;

const PRODUCT_OFFER_ARG_TYPES: Record<string, string> = {
  keyword: 'String',
  productCatId: 'Int',
  shopId: 'Int64',
  itemId: 'Int64',
  listType: 'Int',
  sortType: 'Int',
  page: 'Int',
  limit: 'Int',
  isKeySeller: 'Boolean',
};

const PRODUCT_OFFER_NODE_FIELDS =
  'itemId shopId productName priceMin priceDiscountRate sales commissionRate imageUrl shopName productLink';

/**
 * Monta a query pedindo SÓ os argumentos realmente usados nesta chamada.
 *
 * Declarar um argumento e não enviá-lo faz o GraphQL mandar `null` explícito para ele, e o
 * backend da Shopee (Go/gqlgen) rejeita a requisição inteira com "graphql: got null for non-null"
 * (extensions.code=10010) — erro de coerção de input, que não diz qual argumento é. Por isso uma
 * busca por keyword nunca pode declarar shopId/itemId/productCatId/listType/isKeySeller.
 * A CHECK_CONNECTION_QUERY sempre funcionou justamente por declarar um argumento só.
 */
function buildProductOfferQuery(vars: Record<string, unknown>): string {
  const names = Object.keys(vars).filter(
    (k) => vars[k] !== undefined && PRODUCT_OFFER_ARG_TYPES[k] !== undefined,
  );
  const decls = names.map((n) => `$${n}: ${PRODUCT_OFFER_ARG_TYPES[n]}`).join(', ');
  const args = names.map((n) => `${n}: $${n}`).join(', ');
  return `
query ProductOffer(${decls}) {
  productOfferV2(${args}) {
    nodes { ${PRODUCT_OFFER_NODE_FIELDS} }
    pageInfo { page limit hasNextPage }
  }
}`;
}

// Query enxuta usada só para validar credenciais (checkConnection). A PRODUCT_OFFER_QUERY
// completa pede campos (ex: shopType, periodStartTime) que a Shopee retorna null para produtos
// sem esses dados quando a busca não tem nenhum filtro — o que já disparou "got null for non-null"
// mesmo com credenciais válidas. Ver documentação: query mínima recomendada é itemId+productName.
const CHECK_CONNECTION_QUERY = `
query CheckConnection($limit: Int) {
  productOfferV2(limit: $limit) {
    nodes { itemId productName }
    pageInfo { page }
  }
}`;

const SHORT_LINK_MUTATION = `
mutation ShortLink($originUrl: String!, $subIds: [String!]) {
  generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) { shortLink }
}`;

interface OfferResponse {
  productOfferV2: { nodes: ShopeeProductOfferNode[]; pageInfo: { hasNextPage: boolean } };
}
interface ShortLinkResponse {
  generateShortLink: { shortLink: string };
}

export interface ShopeeAdapterOptions {
  mock?: boolean;
  fetchImpl?: typeof fetch;
}

export function createShopeeAdapter(
  opts: ShopeeAdapterOptions = {},
): MarketplaceAdapter<ShopeeCredentials> {
  const mock = opts.mock ?? process.env.SHOPEE_MOCK === '1';
  const client = (creds: ShopeeCredentials) => new ShopeeGraphQLClient(creds, opts.fetchImpl);

  // Item extra só visível via busca dirigida por itemId (fetchByUrls) em modo mock, para
  // permitir testar a importação de um produto ainda não retornado pela busca genérica sem
  // alterar o tamanho dos resultados de `search` esperado pelos demais testes/fixtures.
  const MOCK_EXTRA_NODE: ShopeeProductOfferNode = {
    itemId: 555555,
    shopId: 789012,
    productName: 'SSD NVMe 1TB',
    priceMin: '399.90',
    priceMax: '399.90',
    priceDiscountRate: 10,
    sales: 3,
    commissionRate: '0.04',
    imageUrl: 'https://cf.shopee.com.br/file/ghi',
    shopName: 'Loja Storage',
    shopType: [],
    productLink: 'https://shopee.com.br/product/789012/555555',
    offerLink: 'https://s.shopee.com.br/rst',
    periodStartTime: 0,
    periodEndTime: 0,
  };

  async function searchPage(
    creds: ShopeeCredentials,
    vars: Record<string, unknown>,
  ): Promise<OfferResponse> {
    if (mock) {
      const data = offersFixture.data as unknown as OfferResponse;
      if (String(vars.itemId) === String(MOCK_EXTRA_NODE.itemId)) {
        return {
          productOfferV2: { nodes: [MOCK_EXTRA_NODE], pageInfo: data.productOfferV2.pageInfo },
        };
      }
      return data;
    }
    return client(creds).request<OfferResponse>(buildProductOfferQuery(vars), vars);
  }

  return {
    kind: 'SHOPEE',

    async checkConnection(creds): Promise<ConnectionStatus> {
      if (mock) return { ok: true };
      try {
        await client(creds).request(CHECK_CONNECTION_QUERY, { limit: 1 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async search(creds, q: SearchQuery): Promise<ProductData[]> {
      const vars: Record<string, unknown> = {
        sortType: SORT_MAP[q.sort],
        limit: Math.min(q.limit, 50),
        page: 1,
      };
      if (q.mode === 'keyword') vars.keyword = q.query;
      if (q.mode === 'category') vars.productCatId = Number(q.categoryId);
      // shopId é Int64 na Open Platform, e esse escalar espera o valor como string no JSON
      // (evita perda de precisão em inteiros de 64 bits) — mandar Number() quebra com "wrong
      // type", diferente de campos Int normais como productCatId, que aceitam número.
      if (q.mode === 'shop') vars.shopId = q.shopId;
      if (q.mode === 'trending') vars.listType = 2;
      // A Open Platform removeu o argumento isOfficialShop de productOfferV2; isKeySeller
      // continua válido e é a aproximação disponível para o filtro de "vendedores top".
      if (q.topSellers) {
        vars.isKeySeller = true;
      }
      const out: ProductData[] = [];
      let page = 1;
      while (out.length < q.limit) {
        const res = await searchPage(creds, { ...vars, page });
        const nodes = res.productOfferV2.nodes.map(mapProductOffer);
        out.push(...nodes);
        if (!res.productOfferV2.pageInfo.hasNextPage || nodes.length === 0 || mock) break;
        page++;
      }
      const filtered = q.extraCommission
        ? out.filter((p) => (p.commissionPct ?? 0) > EXTRA_COMMISSION_MIN_PCT)
        : out;
      return filtered.slice(0, q.limit);
    },

    async fetchByUrls(creds, urls): Promise<ProductData[]> {
      const out: ProductData[] = [];
      for (const url of urls) {
        const parsed = parseProductUrl(url);
        if (parsed.source !== 'SHOPEE') continue;
        // itemId é Int64 também — mesma regra do shopId acima, precisa ir como string.
        const res = await searchPage(creds, {
          itemId: parsed.externalId,
          limit: 1,
          page: 1,
        });
        const node = res.productOfferV2.nodes.find((n) => String(n.itemId) === parsed.externalId);
        if (node) out.push(mapProductOffer(node));
      }
      return out;
    },

    async toAffiliateLink(creds, url, subId): Promise<string> {
      if (mock) return shortLinkFixture.data.generateShortLink.shortLink;
      const res = await client(creds).request<ShortLinkResponse>(SHORT_LINK_MUTATION, {
        originUrl: url,
        subIds: subId ? [subId] : [],
      });
      return res.generateShortLink.shortLink;
    },
  };
}
