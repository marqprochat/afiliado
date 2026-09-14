import type { MarketplaceKind, ProductData, SearchQuery } from '@afilados/shared';

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
}

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

export interface MarketplaceAdapter<C = unknown> {
  readonly kind: MarketplaceKind;
  checkConnection(creds: C): Promise<ConnectionStatus>;
  /** Só marketplaces com API de busca (Shopee). */
  search?(creds: C, query: SearchQuery): Promise<ProductData[]>;
  fetchByUrls(creds: C, urls: string[]): Promise<ProductData[]>;
  toAffiliateLink(creds: C, url: string, subId?: string): Promise<string>;
}
