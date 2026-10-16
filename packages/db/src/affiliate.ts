import type { MarketplaceConnection, MarketplaceKind } from '@prisma/client';
import type { StoredAiConfig } from '@afilados/shared';
import { prisma } from './client';

const AI_KEY = 'ai';

export interface ResolvedConnection {
  /** Linha com as credenciais: a do tenant pai (afiliado) ou a do próprio tenant (raiz). */
  row: MarketplaceConnection | null;
  /** Tenant que guarda as credenciais; é onde renovações de token são gravadas. */
  ownerTenantId: string;
  /** SubID/tracking ID/etiqueta/loja do afiliado; sempre null em tenant raiz. */
  subId: string | null;
  isAffiliate: boolean;
}

export async function getParentTenantId(tenantId: string): Promise<string | null> {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { parentTenantId: true },
  });
  return t.parentTenantId;
}

export async function resolveConnection(
  tenantId: string,
  kind: MarketplaceKind,
): Promise<ResolvedConnection> {
  const parentId = await getParentTenantId(tenantId);
  if (!parentId) {
    const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
    return { row, ownerTenantId: tenantId, subId: null, isAffiliate: false };
  }
  const [own, owner] = await Promise.all([
    prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } }),
    prisma.marketplaceConnection.findFirst({ where: { tenantId: parentId, kind } }),
  ]);
  return {
    row: owner,
    ownerTenantId: parentId,
    subId: own?.subId?.trim() || null,
    isAffiliate: true,
  };
}

export async function resolveConnections(
  tenantId: string,
): Promise<Map<MarketplaceKind, ResolvedConnection>> {
  const parentId = await getParentTenantId(tenantId);
  const own = await prisma.marketplaceConnection.findMany({ where: { tenantId } });
  const map = new Map<MarketplaceKind, ResolvedConnection>();
  if (!parentId) {
    for (const row of own) {
      map.set(row.kind, { row, ownerTenantId: tenantId, subId: null, isAffiliate: false });
    }
    return map;
  }
  const owner = await prisma.marketplaceConnection.findMany({ where: { tenantId: parentId } });
  for (const row of owner) {
    const mine = own.find((o) => o.kind === row.kind);
    map.set(row.kind, {
      row,
      ownerTenantId: parentId,
      subId: mine?.subId?.trim() || null,
      isAffiliate: true,
    });
  }
  return map;
}

/** Credenciais de IA vêm do pai; preferências (ativar, tom, emojis...) são do afiliado. */
export function mergeAffiliateAi(
  own: StoredAiConfig | undefined,
  parent: StoredAiConfig | undefined,
): StoredAiConfig {
  const { baseUrl: _b, model: _m, encryptedApiKey: _k, ...ownRest } = (own ?? {}) as Partial<StoredAiConfig>;
  return {
    ...ownRest,
    enabled: own?.enabled ?? false,
    baseUrl: parent?.baseUrl ?? '',
    model: parent?.model ?? '',
    ...(parent?.encryptedApiKey ? { encryptedApiKey: parent.encryptedApiKey } : {}),
  };
}

export async function resolveSettings(tenantId: string): Promise<Record<string, unknown>> {
  const parentId = await getParentTenantId(tenantId);
  const rows = await prisma.setting.findMany({ where: { tenantId } });
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  if (parentId) {
    const parentAi = await prisma.setting.findFirst({ where: { tenantId: parentId, key: AI_KEY } });
    settings[AI_KEY] = mergeAffiliateAi(
      settings[AI_KEY] as StoredAiConfig | undefined,
      parentAi?.value as StoredAiConfig | undefined,
    );
  }
  return settings;
}

export async function isTenantActive(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
  return t?.active ?? false;
}

/** Tenants ativos que podem usar credenciais de `kinds`: donos com credencial + seus afiliados. */
export async function listTenantsWithCredentials(kinds: MarketplaceKind[]): Promise<string[]> {
  const owners = await prisma.marketplaceConnection.findMany({
    where: { kind: { in: kinds }, encryptedCredentials: { not: null } },
    select: { tenantId: true },
  });
  const ownerIds = [...new Set(owners.map((o) => o.tenantId))];
  const affiliates = ownerIds.length
    ? await prisma.tenant.findMany({
        where: { parentTenantId: { in: ownerIds } },
        select: { id: true },
      })
    : [];
  const all = [...ownerIds, ...affiliates.map((a) => a.id)];
  const active = await prisma.tenant.findMany({
    where: { id: { in: all }, active: true },
    select: { id: true },
  });
  return active.map((t) => t.id);
}
