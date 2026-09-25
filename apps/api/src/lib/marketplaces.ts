import {
  decryptJson,
  encryptJson,
  type ConnectionStatus,
  type MarketplaceConnection,
  type TenantClient,
} from '@afilados/db';
import {
  createShopeeAdapter,
  getAdapter,
  getAliexpressAdapter,
  getAwinAdapter,
  getTagAdapter,
  type AliexpressCredentials,
  type AwinCredentials,
  type AwinFeedListEntry,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { ApiError, requiredTagFields, type TagCredentials } from '@afilados/shared';

let shopee: MarketplaceAdapter<ShopeeCredentials> | null = null;
export function getShopeeAdapter() {
  if (!shopee) shopee = createShopeeAdapter();
  return shopee;
}

type AnyCreds = {
  appId?: string;
  secret?: string;
  feedListUrl?: string;
  feedIds?: string[];
  publisherId?: string;
  offersApiToken?: string;
  appKey?: string;
  appSecret?: string;
  trackingId?: string;
} & TagCredentials;
/** Mesmos campos de `AnyCreds`, mas aceitando `undefined` explícito nos merges (`a ?? b`). */
type LooseCreds = { [K in keyof AnyCreds]?: AnyCreds[K] | undefined };

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
    amazonClientId: creds?.amazonApi?.clientId ?? null,
    hasAmazonApiSecret: Boolean(creds?.amazonApi?.clientSecret),
    hasAwinFeedListUrl: Boolean(creds?.feedListUrl),
    awinFeedIds: creds?.feedIds ?? [],
    awinPublisherId: creds?.publisherId ?? null,
    hasAwinOffersApiToken: Boolean(creds?.offersApiToken),
    aliexpressAppKey: creds?.appKey ?? null,
    hasAliexpressAppSecret: Boolean(creds?.appSecret),
    aliexpressTrackingId: creds?.trackingId ?? null,
    // Sessões sincronizadas (cookies nunca saem daqui, só metadados)
    mlSessionSyncedAt: creds?.mlSession?.syncedAt ?? null,
    mlSessionSource: creds?.mlSession?.source ?? null,
    amazonSessionSyncedAt: creds?.amazonSession?.syncedAt ?? null,
    amazonSessionSource: creds?.amazonSession?.source ?? null,
    magaluSessionSyncedAt: creds?.magaluSession?.syncedAt ?? null,
    magaluSessionSource: creds?.magaluSession?.source ?? null,
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
  // ML com sessão sincronizada gera o link oficial mesmo sem matt_word/matt_tool
  const hasMlSession = kind === 'MERCADOLIVRE' && Boolean(creds.mlSession?.cookies);
  if (missing.length && !hasMlSession) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      `${kind}: configure ${missing.join(', ')} em Configurações`,
      400,
    );
  }
  if (kind === 'AMAZON' && (!creds.amazonApi?.clientId || !creds.amazonApi?.clientSecret)) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'AMAZON: configure Client ID/Secret da Creators API em Configurações',
      400,
    );
  }
  return creds;
}

export async function loadAwinCredentials(db: TenantClient): Promise<AwinCredentials> {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'AWIN' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AwinCredentials>);
  if (!creds.feedListUrl) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'AWIN: cole o link da lista de feeds em Configurações',
      400,
    );
  }
  return {
    feedListUrl: creds.feedListUrl,
    feedIds: creds.feedIds ?? [],
    ...(creds.publisherId ? { publisherId: creds.publisherId } : {}),
    ...(creds.offersApiToken ? { offersApiToken: creds.offersApiToken } : {}),
  };
}

export async function loadAliexpressCredentials(db: TenantClient): Promise<AliexpressCredentials> {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'ALIEXPRESS' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AliexpressCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AliexpressCredentials>);
  if (!creds.appKey || !creds.appSecret || !creds.trackingId) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'ALIEXPRESS: configure App Key, App Secret e Tracking ID em Configurações',
      400,
    );
  }
  return creds as AliexpressCredentials;
}


/**
 * Decripta as credenciais atuais de um marketplace, aplica `mutate` para produzir as
 * novas credenciais, criptografa e faz upsert da linha (create se ainda não existir,
 * updateMany caso contrário — sempre via `TenantClient`, nunca por chave única).
 *
 * Centraliza o padrão "decrypt → merge → encrypt → upsert" repetido em
 * `routes/marketplaces.ts` (PUT e POST /session) e `routes/extension.ts` (sync da
 * extensão) — um único ponto evita que um campo novo (ex: `amazonSession`) seja
 * esquecido em uma das cópias, como ocorreu com o PUT antes desta função existir.
 *
 * `buildExtra` recebe as credenciais já mescladas (e a linha existente, se houver) e
 * decide os demais campos de `MarketplaceConnection` a gravar (status, affiliateTag,
 * lastError, lastCheckedAt) — cada chamador decide o que é relevante para o seu caso.
 */
export async function upsertMarketplaceCredentials(
  db: TenantClient,
  kind: MarketplaceConnection['kind'],
  mutate: (prev: LooseCreds) => LooseCreds,
  buildExtra: (
    merged: LooseCreds,
    existing: MarketplaceConnection | null,
  ) => {
    status: ConnectionStatus;
    affiliateTag?: string | null;
    lastError?: string | null;
    lastCheckedAt?: Date | null;
  },
): Promise<MarketplaceConnection> {
  const existing = await db.marketplaceConnection.findFirst({ where: { kind } });
  const prev: LooseCreds = existing?.encryptedCredentials
    ? decryptJson<AnyCreds>(Buffer.from(existing.encryptedCredentials))
    : {};
  const merged = mutate(prev);
  const hasAny = Object.values(merged).some((v) => v);
  const extra = buildExtra(merged, existing ?? null);
  const data = {
    encryptedCredentials: hasAny ? encryptJson(merged) : null,
    ...extra,
  };
  if (existing) {
    await db.marketplaceConnection.updateMany({ where: { id: existing.id }, data });
  } else {
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    await db.marketplaceConnection.create({ data: { kind, ...data } });
  }
  return (await db.marketplaceConnection.findFirst({ where: { kind } }))!;
}

/**
 * Filtra só os feeds ativos (`membershipStatus === 'active'`) e ordena BR primeiro, depois por
 * nome do anunciante — usado tanto por GET /marketplaces/awin/feeds quanto testável isolado.
 */
export function selectableAwinFeeds(feeds: AwinFeedListEntry[]): AwinFeedListEntry[] {
  return feeds
    .filter((f) => f.membershipStatus === 'active')
    .sort((a, b) => {
      const aBr = a.region === 'BR' ? 0 : 1;
      const bBr = b.region === 'BR' ? 0 : 1;
      if (aBr !== bBr) return aBr - bBr;
      return a.advertiserName.localeCompare(b.advertiserName);
    });
}

export { getAdapter, getAwinAdapter, getTagAdapter, getAliexpressAdapter };
