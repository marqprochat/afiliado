import type { MarketplaceKind } from '@afilados/shared';

export interface CouponUpsertInput {
  store: MarketplaceKind;
  scope: string; // '' ou advertiser.id
  advertiserName: string | null;
  code: string; // normalizado
  description: string;
  terms: string | null;
  discountType: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
  discountValue: number | null;
  minSpend: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  sourceUrl: string | null;
  affiliateUrl: string | null;
  externalId: string | null;
  remainingUses: number | null;
}
