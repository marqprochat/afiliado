import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import type { MarketplaceAdapter, ShopeeCredentials } from './adapter';
import { createShopeeAdapter } from './shopee/adapter';
import { createTagAdapter, type TagKind } from './tag-adapter';

export type AnyAdapter = MarketplaceAdapter<ShopeeCredentials> | MarketplaceAdapter<TagCredentials>;

const cache = new Map<MarketplaceKind, AnyAdapter>();

export function getAdapter(
  kind: MarketplaceKind,
  opts: { shopee?: MarketplaceAdapter<ShopeeCredentials> } = {},
): AnyAdapter {
  if (kind === 'SHOPEE' && opts.shopee) return opts.shopee;
  let a = cache.get(kind);
  if (!a) {
    a = kind === 'SHOPEE' ? createShopeeAdapter() : createTagAdapter(kind as TagKind);
    cache.set(kind, a);
  }
  return a;
}
