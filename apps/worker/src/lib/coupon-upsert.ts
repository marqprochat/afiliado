import { prisma } from '@afilados/db';
import type { CouponOrigin } from '@afilados/shared';
import type { CouponUpsertInput } from '@afilados/marketplaces';

export async function upsertCoupon(
  tenantId: string,
  input: CouponUpsertInput,
  origin: 'API' | 'EXTENSION' | 'MIRROR',
  now: Date,
): Promise<'created' | 'updated'> {
  const existing = await prisma.coupon.findUnique({
    where: {
      tenantId_store_code_scope: {
        tenantId,
        store: input.store,
        code: input.code,
        scope: input.scope,
      },
    },
  });

  if (!existing) {
    const isExpired = Boolean(input.expiresAt && input.expiresAt.getTime() < now.getTime());
    const initialStatus = isExpired ? 'EXPIRED' : 'UNVERIFIED';

    const created = await prisma.coupon.create({
      data: {
        tenantId,
        store: input.store,
        scope: input.scope,
        advertiserName: input.advertiserName ?? null,
        code: input.code,
        description: input.description,
        terms: input.terms ?? null,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue !== null && input.discountValue !== undefined ? input.discountValue : null,
        minSpend: input.minSpend !== null && input.minSpend !== undefined ? input.minSpend : null,
        startsAt: input.startsAt ?? null,
        expiresAt: input.expiresAt ?? null,
        sourceUrl: input.sourceUrl ?? null,
        affiliateUrl: input.affiliateUrl ?? null,
        externalId: input.externalId ?? null,
        remainingUses: input.remainingUses ?? null,
        origin: origin as CouponOrigin,
        status: initialStatus,
        lastSeenAt: now,
        fetchedAt: now,
      },
    });

    if (isExpired) {
      await prisma.couponCheck.create({
        data: {
          tenantId,
          couponId: created.id,
          result: 'EXPIRED',
          method: 'EXPIRY',
          note: 'Expirado na importação',
        },
      });
    }

    return 'created';
  }

  // Update existing coupon
  const expiresAt = input.expiresAt ?? existing.expiresAt;
  const isExpired = Boolean(expiresAt && expiresAt.getTime() < now.getTime());

  let statusToSet = existing.status;
  let checkToCreate: { result: 'EXPIRED' | 'INVALID'; method: 'EXPIRY' | 'SOURCE'; note: string } | null = null;

  if (isExpired && existing.status !== 'EXPIRED') {
    statusToSet = 'EXPIRED';
    checkToCreate = { result: 'EXPIRED', method: 'EXPIRY', note: 'Expirado por data' };
  } else if (input.remainingUses === 0 && existing.status !== 'INVALID') {
    statusToSet = 'INVALID';
    checkToCreate = { result: 'INVALID', method: 'SOURCE', note: 'esgotado' };
  }

  await prisma.coupon.update({
    where: { id: existing.id },
    data: {
      advertiserName: input.advertiserName ?? existing.advertiserName,
      description: input.description || existing.description,
      terms: input.terms ?? existing.terms,
      discountType: input.discountType ?? existing.discountType,
      discountValue: input.discountValue !== null ? input.discountValue : existing.discountValue,
      minSpend: input.minSpend !== null ? input.minSpend : existing.minSpend,
      startsAt: input.startsAt ?? existing.startsAt,
      expiresAt: input.expiresAt ?? existing.expiresAt,
      sourceUrl: input.sourceUrl ?? existing.sourceUrl,
      affiliateUrl: input.affiliateUrl ?? existing.affiliateUrl,
      externalId: input.externalId ?? existing.externalId,
      remainingUses: input.remainingUses !== null ? input.remainingUses : existing.remainingUses,
      status: statusToSet,
      lastSeenAt: now,
    },
  });

  if (checkToCreate) {
    await prisma.couponCheck.create({
      data: {
        tenantId,
        couponId: existing.id,
        result: checkToCreate.result,
        method: checkToCreate.method,
        note: checkToCreate.note,
      },
    });
  }

  return 'updated';
}
