import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import type { AwinCredentials, MarketplaceAdapter, ShopeeCredentials } from './adapter';
import { createShopeeAdapter } from './shopee/adapter';
import { createTagAdapter, type TagKind } from './tag-adapter';
import { createAwinAdapter } from './awin/adapter';

export type AnyAdapter =
  | MarketplaceAdapter<ShopeeCredentials>
  | MarketplaceAdapter<TagCredentials>
  | MarketplaceAdapter<AwinCredentials>;

const cache = new Map<MarketplaceKind, AnyAdapter>();

/** Adapter tipado para lojas convertidas por tag (Amazon, ML, Magalu). */
export function getTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return getAdapter(kind) as MarketplaceAdapter<TagCredentials>;
}

/** Adapter tipado para a Awin. */
export function getAwinAdapter(): MarketplaceAdapter<AwinCredentials> {
  return getAdapter('AWIN') as MarketplaceAdapter<AwinCredentials>;
}

export function getAdapter(
  kind: MarketplaceKind,
  opts: { shopee?: MarketplaceAdapter<ShopeeCredentials> } = {},
): AnyAdapter {
  if (kind === 'SHOPEE' && opts.shopee) return opts.shopee;
  let a = cache.get(kind);
  if (!a) {
    a =
      kind === 'SHOPEE'
        ? createShopeeAdapter()
        : kind === 'AWIN'
          ? createAwinAdapter()
          : createTagAdapter(kind as TagKind);
    cache.set(kind, a);
  }
  return a;
}
