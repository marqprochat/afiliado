import type { Coupon, CouponCheck } from '@afilados/db';

export function toApiCouponCheck(check: CouponCheck) {
  return {
    id: check.id,
    couponId: check.couponId,
    createdAt: check.createdAt.toISOString(),
    method: check.method,
    result: check.result,
    note: check.note,
  };
}

export function toApiCoupon(c: Coupon & { checks?: CouponCheck[] }) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    store: c.store,
    scope: c.scope,
    advertiserName: c.advertiserName,
    code: c.code,
    description: c.description,
    terms: c.terms,
    discountType: c.discountType,
    discountValue: c.discountValue ? Number(c.discountValue) : null,
    minSpend: c.minSpend ? Number(c.minSpend) : null,
    startsAt: c.startsAt ? c.startsAt.toISOString() : null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    status: c.status,
    origin: c.origin,
    sourceUrl: c.sourceUrl,
    affiliateUrl: c.affiliateUrl,
    externalId: c.externalId,
    remainingUses: c.remainingUses,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    lastVerifiedAt: c.lastVerifiedAt ? c.lastVerifiedAt.toISOString() : null,
    fetchedAt: c.fetchedAt ? c.fetchedAt.toISOString() : new Date().toISOString(),
    createdAt: c.fetchedAt ? c.fetchedAt.toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? c.updatedAt.toISOString() : new Date().toISOString(),
    ...(c.checks ? { checks: c.checks.map(toApiCouponCheck) } : {}),
  };
}
