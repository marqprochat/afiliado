import { decryptJson, type MarketplaceConnection, type TenantClient } from '@afilados/db';
import {
  createShopeeAdapter,
  getAdapter,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { ApiError, requiredTagFields, type TagCredentials } from '@afilados/shared';

let shopee: MarketplaceAdapter<ShopeeCredentials> | null = null;
export function getShopeeAdapter() {
  if (!shopee) shopee = createShopeeAdapter();
  return shopee;
}

type AnyCreds = { appId?: string; secret?: string } & TagCredentials;

export function publicConnection(
  row: MarketplaceConnection | null,
  kind: MarketplaceConnection['kind'],
) {
  const creds = row?.encryptedCredentials
    ? decryptJson<AnyCreds>(Buffer.from(row.encryptedCredentials))
    : null;
  return {
    kind,
    status: row?.status ?? 'UNCONFIGURED',
    affiliateTag: row?.affiliateTag ?? null,
    appId: creds?.appId ?? null,
    hasSecret: Boolean(creds?.secret),
    mattWord: creds?.mattWord ?? null,
    mattTool: creds?.mattTool ?? null,
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

/** Credenciais por tag (Amazon/ML/Magalu) já validadas; lança SHOPEE_UNCONFIGURED-like para as demais. */
export async function loadTagCredentials(
  db: TenantClient,
  kind: 'AMAZON' | 'MAGALU' | 'MERCADOLIVRE',
) {
  const row = await db.marketplaceConnection.findFirst({ where: { kind } });
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  const missing = requiredTagFields(kind).filter((f) => !creds[f]);
  if (missing.length) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      `${kind}: configure ${missing.join(', ')} em Configurações`,
      400,
    );
  }
  return creds;
}

export { getAdapter };
