import { decryptJson, type MarketplaceConnection, type TenantClient } from '@afilados/db';
import {
  createShopeeAdapter,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { ApiError } from '@afilados/shared';

let shopee: MarketplaceAdapter<ShopeeCredentials> | null = null;
export function getShopeeAdapter() {
  if (!shopee) shopee = createShopeeAdapter();
  return shopee;
}

export function publicConnection(
  row: MarketplaceConnection | null,
  kind: MarketplaceConnection['kind'],
) {
  const creds = row?.encryptedCredentials
    ? decryptJson<{ appId?: string; secret?: string }>(Buffer.from(row.encryptedCredentials))
    : null;
  return {
    kind,
    status: row?.status ?? 'UNCONFIGURED',
    affiliateTag: row?.affiliateTag ?? null,
    appId: creds?.appId ?? null,
    hasSecret: Boolean(creds?.secret),
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function loadShopeeCredentials(db: TenantClient) {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'SHOPEE' } });
  if (!row?.encryptedCredentials) {
    throw new ApiError('SHOPEE_UNCONFIGURED', 'Configure a API da Shopee em Configurações', 400);
  }
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(row.encryptedCredentials));
  return { creds, affiliateTag: row.affiliateTag };
}
