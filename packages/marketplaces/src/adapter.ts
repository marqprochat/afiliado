import type { MarketplaceKind, ProductData, SearchQuery } from '@afilados/shared';

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
}

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

export interface AwinCredentials {
  feedListUrl: string;
  feedIds: string[];
  publisherId?: string | undefined;
  offersApiToken?: string | undefined;
  partners?: Record<string, { advertiserId: string; name: string }> | undefined;
}

export interface AliexpressCredentials {
  appKey: string;
  appSecret: string;
  trackingId: string;
}

export interface MarketplaceAdapter<C = unknown> {
  readonly kind: MarketplaceKind;
  checkConnection(creds: C): Promise<ConnectionStatus>;
  /** Só marketplaces com API de busca (Shopee). */
  search?(creds: C, query: SearchQuery): Promise<ProductData[]>;
  fetchByUrls(creds: C, urls: string[]): Promise<ProductData[]>;
  /** `extraSubIds` só é usado pela Shopee (subIds = [subId, ...extraSubIds]); os demais ignoram. */
  toAffiliateLink(creds: C, url: string, subId?: string, extraSubIds?: string[]): Promise<string>;
}
