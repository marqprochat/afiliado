import type { CouponStatus } from '@afilados/shared';

export type EligibilityResult = { ok: true } | { ok: false; reason: string };

export interface EligibleProductInput {
  title: string;
  price: number;
  images: string[];
  originalUrl: string;
  raw: Record<string, unknown>;
}

export function isEligibleProduct(p: EligibleProductInput): EligibilityResult {
  if (p.raw && p.raw['pendingEnrich'] === true) return { ok: false, reason: 'pending-enrich' };
  if (!p.title.trim() || p.title.trim() === 'Importando…')
    return { ok: false, reason: 'empty-title' };
  if (!(p.price > 0)) return { ok: false, reason: 'invalid-price' };
  if (p.images.length === 0) return { ok: false, reason: 'no-images' };
  try {
    new URL(p.originalUrl);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  return { ok: true };
}

export interface EligibleCouponInput {
  code: string;
  expiresAt: string | null;
  status?: CouponStatus;
}

export function isEligibleCoupon(c: EligibleCouponInput): EligibilityResult {
  if (c.status === 'INVALID') return { ok: false, reason: 'invalid' };
  if (c.status === 'EXPIRED') return { ok: false, reason: 'expired' };
  if (!c.code.trim()) return { ok: false, reason: 'empty-code' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now())
    return { ok: false, reason: 'expired' };
  return { ok: true };
}
