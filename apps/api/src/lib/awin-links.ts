import { decryptJson, resolveConnection, type TenantClient } from '@afilados/db';
import { ApiError } from '@afilados/shared';
import {
  AwinApiError,
  buildAwinTrackingLink,
  extractCleanDomain,
  generateAwinLinksBatch,
  getAwinLinkQuota,
  parseAwinCreadLink,
  type AwinCredentials,
  type AwinLinkQuota,
  type AwinLinkRequest,
  type AwinPartnerDomain,
} from '@afilados/marketplaces';
import { getAwinPartnersForTenant } from './awin-partners';
import { getRedis } from './redis';

/** Chave do setting (tabela Setting) que liga os links curtos no envio. */
export const AWIN_SHORT_LINKS_KEY = 'awinShortLinks';
/** Cache da cota de links curtos, por tenant (o worker lê a mesma chave). */
export const awinQuotaCacheKey = (tenantId: string) => `awin:link-quota:${tenantId}`;
const QUOTA_TTL_SECONDS = 600;

export interface AwinBatchLinkItem {
  input: string;
  url: string | null;
  source?: 'api' | 'canonical';
  error?: string;
}

async function withTimeout<T>(p: Promise<T>, ms = 1000): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

async function loadCreds(tenantId: string) {
  const resolved = await resolveConnection(tenantId, 'AWIN');
  const stored = resolved.row?.encryptedCredentials
    ? decryptJson<Partial<AwinCredentials>>(Buffer.from(resolved.row.encryptedCredentials))
    : {};
  return {
    publisherId: stored.publisherId?.trim() || null,
    token: stored.offersApiToken?.trim() || null,
    subId: resolved.subId ?? null,
  };
}

function matchPartner(
  partners: Record<string, AwinPartnerDomain>,
  url: string,
): AwinPartnerDomain | null {
  const domain = extractCleanDomain(url);
  return (
    partners[domain] ??
    Object.values(partners).find((p) => domain === p.domain || domain.endsWith(`.${p.domain}`)) ??
    null
  );
}

/**
 * Converte vários links numa chamada de lote da Awin (blocos de 100). O parceiro de cada URL sai da
 * mesma regra de `generateAwinLinkForTenant`; um `cread.php` colado é lido sem ser requisitado.
 * Item recusado pela API (ou API indisponível) → link canônico; site não parceiro → erro por item.
 */
export async function convertAwinLinksBatch(
  tenantId: string,
  items: { url: string; subId?: string | undefined }[],
): Promise<AwinBatchLinkItem[]> {
  const creds = await loadCreds(tenantId);
  if (!creds.publisherId) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'Informe o Publisher ID da Awin nas conexões para gerar os links',
      400,
    );
  }
  const publisherId = creds.publisherId;
  const { partners } = await getAwinPartnersForTenant(tenantId);

  const out: AwinBatchLinkItem[] = items.map((i) => ({ input: i.url, url: null }));
  const pending: { index: number; request: AwinLinkRequest; subId: string | null }[] = [];

  items.forEach((item, index) => {
    const subId = item.subId ?? creds.subId;
    const parsed = parseAwinCreadLink(item.url);
    let request: AwinLinkRequest | null = null;
    if (parsed) {
      request = { advertiserId: parsed.advertiserId, destinationUrl: parsed.destinationUrl };
    } else {
      const partner = matchPartner(partners, item.url);
      if (partner) {
        request = { advertiserId: Number(partner.advertiserId), destinationUrl: item.url.trim() };
      }
    }
    if (!request) {
      out[index]!.error = `O site "${extractCleanDomain(item.url)}" não foi identificado como parceiro aprovado na sua conta Awin`;
      return;
    }
    if (subId) request.parameters = { clickref: subId };
    pending.push({ index, request, subId });
  });

  let results: Awaited<ReturnType<typeof generateAwinLinksBatch>> | null = null;
  if (creds.token && pending.length) {
    try {
      results = await generateAwinLinksBatch(
        { publisherId, offersApiToken: creds.token },
        pending.map((p) => p.request),
      );
    } catch (err) {
      // Token inválido/expirado: segue com os links canônicos (o envio usa o mesmo formato).
      if (!(err instanceof AwinApiError)) throw err;
      results = null;
    }
  }

  pending.forEach((p, i) => {
    const r = results?.[i];
    if (r?.ok) {
      out[p.index] = { input: out[p.index]!.input, url: r.url, source: 'api' };
      return;
    }
    out[p.index] = {
      input: out[p.index]!.input,
      url: buildAwinTrackingLink({
        publisherId,
        advertiserId: p.request.advertiserId,
        destinationUrl: p.request.destinationUrl,
        subId: p.subId,
      }),
      source: 'canonical',
    };
  });
  return out;
}

/** Cota de links curtos (cache de 10 min por tenant); `null` sem Publisher ID/token. */
export async function getAwinQuotaForTenant(tenantId: string): Promise<AwinLinkQuota | null> {
  const creds = await loadCreds(tenantId);
  if (!creds.publisherId || !creds.token) return null;
  const key = awinQuotaCacheKey(tenantId);
  const cached = await withTimeout(getRedis().get(key));
  if (cached) {
    try {
      return JSON.parse(cached) as AwinLinkQuota;
    } catch {
      // cache corrompido: busca de novo
    }
  }
  const quota = await getAwinLinkQuota({ publisherId: creds.publisherId, offersApiToken: creds.token });
  await withTimeout(getRedis().set(key, JSON.stringify(quota), 'EX', QUOTA_TTL_SECONDS));
  return quota;
}

export async function getAwinShortLinksEnabled(db: TenantClient): Promise<boolean> {
  const row = await db.setting.findFirst({ where: { key: AWIN_SHORT_LINKS_KEY } });
  return row?.value === true;
}

export async function setAwinShortLinksEnabled(
  db: TenantClient,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await db.setting.upsert({
    where: { tenantId_key: { tenantId, key: AWIN_SHORT_LINKS_KEY } },
    update: { value: enabled },
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    create: { key: AWIN_SHORT_LINKS_KEY, value: enabled },
  });
}
