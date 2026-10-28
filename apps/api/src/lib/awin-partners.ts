import { decryptJson, resolveConnection, forTenant } from '@afilados/db';
import {
  listAwinProgrammes,
  listAwinVouchers,
  mapProgrammesToDomains,
  DEFAULT_AWIN_PARTNERS,
  buildAwinTrackingLink,
  generateAwinTrackingLinkViaApi,
  extractCleanDomain,
  type AwinCredentials,
  type AwinPartnerDomain,
} from '@afilados/marketplaces';
import { getRedis } from './redis';

async function safeRedisGet(key: string): Promise<string | null> {
  try {
    const r = getRedis();
    if (r.status !== 'ready') return null;
    return await Promise.race([
      r.get(key),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 300)),
    ]);
  } catch {
    return null;
  }
}

async function safeRedisSet(key: string, value: string, ttlSeconds = 3600): Promise<void> {
  try {
    const r = getRedis();
    if (r.status !== 'ready') return;
    await Promise.race([
      r.set(key, value, 'EX', ttlSeconds),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 300)),
    ]);
  } catch {
    // Ignora falhas de cache
  }
}

export async function getAwinPartnersForTenant(tenantId: string): Promise<{
  publisherId: string | null;
  partners: Record<string, AwinPartnerDomain>;
}> {
  const { row } = await resolveConnection(tenantId, 'AWIN');
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : null;

  const publisherId = creds?.publisherId?.trim() || null;
  const token = creds?.offersApiToken?.trim() || null;

  const partnersMap: Record<string, AwinPartnerDomain> = {
    ...DEFAULT_AWIN_PARTNERS,
  };

  if (publisherId && token) {
    const cacheKey = `awin:partners:${tenantId}`;
    const cached = await safeRedisGet(cacheKey);
    if (cached) {
      try {
        return {
          publisherId,
          partners: JSON.parse(cached),
        };
      } catch {}
    }

    try {
      const progs = await listAwinProgrammes({ publisherId, offersApiToken: token });
      const mapped = mapProgrammesToDomains(progs);
      for (const [domain, p] of Object.entries(mapped)) {
        partnersMap[domain] = p;
      }
      await safeRedisSet(cacheKey, JSON.stringify(partnersMap), 3600);
    } catch {
      // Se a API da Awin falhar (timeout ou rate-limit), mantém DEFAULT_AWIN_PARTNERS
    }
  }

  return {
    publisherId,
    partners: partnersMap,
  };
}

export async function generateAwinLinkForTenant(
  tenantId: string,
  params: {
    destinationUrl: string;
    advertiserId?: string | number | undefined;
    subId?: string | null | undefined;
    shorten?: boolean | undefined;
  },
): Promise<{ url: string; shortened: boolean; partner?: AwinPartnerDomain | null }> {
  const { row } = await resolveConnection(tenantId, 'AWIN');
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : null;

  const publisherId = creds?.publisherId?.trim() || null;
  if (!publisherId) {
    throw new Error('Awin Publisher ID não configurado nas conexões da sua conta.');
  }

  const { partners } = await getAwinPartnersForTenant(tenantId);
  const domain = extractCleanDomain(params.destinationUrl);
  const matchedPartner =
    partners[domain] ||
    Object.values(partners).find(
      (p) => domain === p.domain || domain.endsWith(`.${p.domain}`),
    ) ||
    null;

  let advertiserId = params.advertiserId;
  if (!advertiserId && matchedPartner) {
    advertiserId = matchedPartner.advertiserId;
  }

  if (!advertiserId) {
    throw new Error(
      `O site "${domain}" não foi identificado como um parceiro aprovado na sua conta Awin.`,
    );
  }

  const result = await generateAwinTrackingLinkViaApi(
    { publisherId, offersApiToken: creds?.offersApiToken?.trim() },
    {
      advertiserId,
      destinationUrl: params.destinationUrl,
      ...(params.subId ? { subId: params.subId } : {}),
      ...(params.shorten !== undefined ? { shorten: params.shorten } : {}),
    },
  );

  return {
    url: result.url,
    shortened: result.shortened,
    partner: matchedPartner,
  };
}

export async function syncAwinCouponsForTenant(tenantId: string): Promise<number> {
  const { row } = await resolveConnection(tenantId, 'AWIN');
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : null;

  const publisherId = creds?.publisherId?.trim() || null;
  const token = creds?.offersApiToken?.trim() || null;
  if (!publisherId || !token) return 0;

  try {
    const vouchers = await listAwinVouchers({ publisherId, offersApiToken: token });
    const now = new Date();
    let synced = 0;
    const db = forTenant(tenantId);

    for (const v of vouchers) {
      const isExpired = Boolean(v.expiresAt && v.expiresAt.getTime() < now.getTime());
      const initialStatus = isExpired ? 'EXPIRED' : 'UNVERIFIED';

      const existing = await db.coupon.findUnique({
        where: {
          tenantId_store_code_scope: {
            tenantId,
            store: 'AWIN',
            code: v.code,
            scope: v.scope,
          },
        },
      });

      if (!existing) {
        await db.coupon.create({
          data: {
            tenantId,
            store: 'AWIN',
            scope: v.scope,
            advertiserName: v.advertiserName ?? null,
            code: v.code,
            description: v.description,
            terms: v.terms ?? null,
            discountType: v.discountType ?? null,
            discountValue:
              v.discountValue !== null && v.discountValue !== undefined
                ? v.discountValue
                : null,
            minSpend: v.minSpend !== null && v.minSpend !== undefined ? v.minSpend : null,
            startsAt: v.startsAt ?? null,
            expiresAt: v.expiresAt ?? null,
            sourceUrl: v.sourceUrl ?? null,
            affiliateUrl: v.affiliateUrl ?? null,
            externalId: v.externalId ?? null,
            origin: 'API',
            status: initialStatus,
            lastSeenAt: now,
            fetchedAt: now,
          },
        });
        synced++;
      } else {
        await db.coupon.updateMany({
          where: { id: existing.id },
          data: {
            description: v.description,
            terms: v.terms ?? null,
            advertiserName: v.advertiserName ?? existing.advertiserName,
            expiresAt: v.expiresAt ?? existing.expiresAt,
            affiliateUrl: v.affiliateUrl ?? existing.affiliateUrl,
            lastSeenAt: now,
            status: isExpired ? 'EXPIRED' : existing.status === 'EXPIRED' ? 'UNVERIFIED' : existing.status,
          },
        });
        synced++;
      }
    }
    return synced;
  } catch {
    return 0;
  }
}

export async function getAwinCouponsForTenant(
  tenantId: string,
  opts?: { advertiserId?: string | undefined; domain?: string | undefined },
) {
  const db = forTenant(tenantId);
  let advertiserId = opts?.advertiserId;

  if (!advertiserId && opts?.domain) {
    const { partners } = await getAwinPartnersForTenant(tenantId);
    const domain = extractCleanDomain(opts.domain);
    const matched =
      partners[domain] ||
      Object.values(partners).find((p) => domain === p.domain || domain.endsWith(`.${p.domain}`));
    if (matched) {
      advertiserId = matched.advertiserId;
    }
  }

  const now = new Date();
  const where: any = {
    store: 'AWIN',
    status: { in: ['VALID', 'UNVERIFIED'] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };

  if (advertiserId) {
    where.scope = String(advertiserId);
  }

  let rows = await db.coupon.findMany({
    where,
    orderBy: { fetchedAt: 'desc' },
  });

  // Se não tem cupons locais no banco para este anunciante/loja, tenta sincronizar na hora da AWIN
  if (rows.length === 0) {
    const count = await syncAwinCouponsForTenant(tenantId);
    if (count > 0) {
      rows = await db.coupon.findMany({
        where,
        orderBy: { fetchedAt: 'desc' },
      });
    }
  }

  return rows;
}
