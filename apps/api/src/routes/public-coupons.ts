import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, forTenant, resolveConnection, decryptJson } from '@afilados/db';
import { parseProductUrl, resolveShortLinks } from '@afilados/core';
import { resolveOwnerTenantId } from '@afilados/deals';
import {
  getTagAdapter,
  type AliexpressCredentials,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { getAliexpressAdapter, getShopeeAdapter } from '../lib/marketplaces';
import { ApiError, type MarketplaceKind, type TagCredentials } from '@afilados/shared';

const lookupBodySchema = z.object({
  url: z.string().trim().min(4, 'Cole um link válido'),
});

const listPublicCouponsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  store: z.string().trim().max(50).optional(),
});

const STORE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magazine Luiza',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Lojas Parceiras',
};

async function resolvePublicTenantId(): Promise<string | null> {
  const owner = await resolveOwnerTenantId();
  if (owner) return owner;
  const withCoupon = await prisma.coupon.findFirst({ select: { tenantId: true } });
  if (withCoupon?.tenantId) return withCoupon.tenantId;
  const first = await prisma.tenant.findFirst({ select: { id: true } });
  return first?.id ?? null;
}

function normalizeStoreHost(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host.split('.')[0] ?? null;
  } catch {
    return null;
  }
}

async function tryConvertAffiliateUrl(
  tenantId: string,
  source: MarketplaceKind | 'UNSUPPORTED',
  resolvedUrl: string,
): Promise<string> {
  if (source === 'UNSUPPORTED' || source === 'AWIN') return resolvedUrl;
  try {
    const { row, subId } = await resolveConnection(tenantId, source);
    if (!row?.encryptedCredentials) return resolvedUrl;

    if (source === 'SHOPEE') {
      const creds = decryptJson<ShopeeCredentials>(Buffer.from(row.encryptedCredentials));
      return await getShopeeAdapter().toAffiliateLink(creds, resolvedUrl, subId ?? 'cupons-site');
    }
    if (source === 'ALIEXPRESS') {
      const creds = decryptJson<AliexpressCredentials>(Buffer.from(row.encryptedCredentials));
      return await getAliexpressAdapter().toAffiliateLink(
        creds,
        resolvedUrl,
        subId ?? 'cupons-site',
      );
    }
    const creds = decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials));
    if (!creds.tag) return resolvedUrl;
    return await getTagAdapter(source).toAffiliateLink(creds, resolvedUrl, subId ?? undefined);
  } catch {
    return resolvedUrl;
  }
}

export async function publicCouponsRoutes(app: FastifyInstance) {
  /**
   * Lista cupons públicos válidos e não expirados (opcionalmente filtrados por busca ou loja).
   */
  app.get('/public/coupons', async (req) => {
    const q = listPublicCouponsQuery.parse(req.query);
    const tenantId = await resolvePublicTenantId();
    if (!tenantId) return { coupons: [] };

    const now = new Date();
    const db = forTenant(tenantId);
    const rows = await db.coupon.findMany({
      where: {
        status: { in: ['VALID', 'UNVERIFIED'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(q.store ? { store: q.store as MarketplaceKind } : {}),
        ...(q.q
          ? {
              AND: [
                {
                  OR: [
                    { code: { contains: q.q, mode: 'insensitive' } },
                    { description: { contains: q.q, mode: 'insensitive' } },
                    { advertiserName: { contains: q.q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      take: 60,
      orderBy: [{ expiresAt: 'asc' }, { fetchedAt: 'desc' }],
      select: {
        id: true,
        store: true,
        advertiserName: true,
        code: true,
        description: true,
        terms: true,
        discountType: true,
        discountValue: true,
        minSpend: true,
        expiresAt: true,
        affiliateUrl: true,
        sourceUrl: true,
      },
    });

    return {
      coupons: rows.map((c) => ({
        ...c,
        discountValue: c.discountValue ? Number(c.discountValue) : null,
        minSpend: c.minSpend ? Number(c.minSpend) : null,
      })),
    };
  });

  /**
   * Busca cupons compatíveis a partir de um link colado pelo usuário,
   * descartando automaticamente os expirados e gerando link rastreado de afiliado.
   */
  app.post('/public/coupons/lookup', async (req) => {
    const { url } = lookupBodySchema.parse(req.body);
    let normalizedInput = url;
    if (!/^https?:\/\//i.test(normalizedInput)) {
      normalizedInput = `https://${normalizedInput}`;
    }
    try {
      new URL(normalizedInput);
    } catch {
      throw ApiError.validation('Informe uma URL válida (ex: https://shopee.com.br/...)');
    }

    const tenantId = await resolvePublicTenantId();
    const expandedMap = await resolveShortLinks(normalizedInput).catch(() => new Map());
    const resolvedUrl = expandedMap.get(normalizedInput) ?? normalizedInput;
    const parsed = parseProductUrl(resolvedUrl);
    const hostToken = normalizeStoreHost(resolvedUrl);

    if (!tenantId) {
      return {
        marketplace: parsed.source,
        storeLabel: STORE_LABELS[parsed.source] ?? hostToken ?? 'Loja',
        originalUrl: normalizedInput,
        resolvedUrl,
        affiliateUrl: resolvedUrl,
        coupons: [],
      };
    }

    const affiliateUrl = await tryConvertAffiliateUrl(tenantId, parsed.source, resolvedUrl);
    const now = new Date();
    const db = forTenant(tenantId);

    const storeOrConditions = [];
    if (parsed.source !== 'UNSUPPORTED') {
      storeOrConditions.push({ store: parsed.source as MarketplaceKind });
    }
    if (hostToken && hostToken.length >= 3) {
      storeOrConditions.push({ advertiserName: { contains: hostToken, mode: 'insensitive' as const } });
      storeOrConditions.push({ sourceUrl: { contains: hostToken, mode: 'insensitive' as const } });
    }

    const rows =
      storeOrConditions.length > 0
        ? await db.coupon.findMany({
            where: {
              status: { in: ['VALID', 'UNVERIFIED'] },
              AND: [
                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                { OR: storeOrConditions },
              ],
            },
            take: 40,
            orderBy: [{ expiresAt: 'asc' }, { fetchedAt: 'desc' }],
            select: {
              id: true,
              store: true,
              advertiserName: true,
              code: true,
              description: true,
              terms: true,
              discountType: true,
              discountValue: true,
              minSpend: true,
              expiresAt: true,
              affiliateUrl: true,
              sourceUrl: true,
            },
          })
        : [];

    return {
      marketplace: parsed.source,
      storeLabel:
        parsed.source !== 'UNSUPPORTED'
          ? STORE_LABELS[parsed.source]
          : hostToken
            ? hostToken.charAt(0).toUpperCase() + hostToken.slice(1)
            : 'Loja Parceira',
      originalUrl: normalizedInput,
      resolvedUrl,
      affiliateUrl,
      coupons: rows.map((c) => ({
        ...c,
        discountValue: c.discountValue ? Number(c.discountValue) : null,
        minSpend: c.minSpend ? Number(c.minSpend) : null,
      })),
    };
  });
}
