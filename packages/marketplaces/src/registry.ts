import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import type { AliexpressCredentials, AwinCredentials, MarketplaceAdapter, ShopeeCredentials } from './adapter';
import { createShopeeAdapter } from './shopee/adapter';
import { createTagAdapter, type TagKind } from './tag-adapter';
import { createAwinAdapter } from './awin/adapter';
import { createAliexpressAdapter } from './aliexpress/adapter';

export type AnyAdapter =
  | MarketplaceAdapter<ShopeeCredentials>
  | MarketplaceAdapter<TagCredentials>
  | MarketplaceAdapter<AwinCredentials>
  | MarketplaceAdapter<AliexpressCredentials>;

const cache = new Map<MarketplaceKind, AnyAdapter>();

/** Adapter tipado para lojas convertidas por tag (Amazon, ML, Magalu). */
export function getTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return getAdapter(kind) as MarketplaceAdapter<TagCredentials>;
}

/** Adapter tipado para a Awin. */
export function getAwinAdapter(): MarketplaceAdapter<AwinCredentials> {
  return getAdapter('AWIN') as MarketplaceAdapter<AwinCredentials>;
}

/** Adapter tipado para o AliExpress. */
export function getAliexpressAdapter(): MarketplaceAdapter<AliexpressCredentials> {
  return getAdapter('ALIEXPRESS') as MarketplaceAdapter<AliexpressCredentials>;
}

export function getAdapter(
  kind: MarketplaceKind,
  opts: {
    shopee?: MarketplaceAdapter<ShopeeCredentials>;
    aliexpress?: MarketplaceAdapter<AliexpressCredentials>;
  } = {},
): AnyAdapter {
  if (kind === 'SHOPEE' && opts.shopee) return opts.shopee;
  if (kind === 'ALIEXPRESS' && opts.aliexpress) return opts.aliexpress;
  let a = cache.get(kind);
  if (!a) {
    a =
      kind === 'SHOPEE'
        ? createShopeeAdapter()
        : kind === 'AWIN'
          ? createAwinAdapter()
          : kind === 'ALIEXPRESS'
            ? createAliexpressAdapter()
            : createTagAdapter(kind as TagKind);
    cache.set(kind, a);
  }
  return a;
}

