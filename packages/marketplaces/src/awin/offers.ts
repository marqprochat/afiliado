import type { AwinCredentials } from '../adapter';
import type { CouponUpsertInput } from '../coupons';
import { AwinApiError } from './datafeed';

export function mapAwinPromotion(p: any): CouponUpsertInput | null {
  const voucher = p?.voucher;
  const rawCode = voucher?.code;
  if (!rawCode || typeof rawCode !== 'string') return null;
  const trimmedCode = rawCode.trim();
  if (!trimmedCode) return null;

  const advertiser = p?.advertiser ?? {};
  const advertiserId = String(advertiser.id ?? advertiser.advertiserId ?? '');
  const advertiserName = advertiser.name ? String(advertiser.name) : null;

  const title = p?.title ? String(p.title).trim() : 'Cupom Awin';
  const description = p?.description ? String(p.description).trim() : null;
  const terms = p?.terms ? String(p.terms).trim() : null;
  const combinedTerms = [description, terms].filter(Boolean).join('\n') || null;

  const startsAt = p?.startDate ? new Date(p.startDate) : null;
  const expiresAt = p?.endDate ? new Date(p.endDate) : null;

  const sourceUrl = p?.url ? String(p.url) : null;
  const affiliateUrl = p?.urlTracking ? String(p.urlTracking) : null;
  const externalId = p?.promotionId ? String(p.promotionId) : p?.id ? String(p.id) : null;

  return {
    store: 'AWIN',
    scope: advertiserId,
    advertiserName,
    code: trimmedCode.toUpperCase(),
    description: title,
    terms: combinedTerms,
    discountType: null,
    discountValue: null,
    minSpend: null,
    startsAt: startsAt && !isNaN(startsAt.getTime()) ? startsAt : null,
    expiresAt: expiresAt && !isNaN(expiresAt.getTime()) ? expiresAt : null,
    sourceUrl,
    affiliateUrl,
    externalId,
    remainingUses: null,
  };
}

export async function listAwinVouchers(
  creds: Required<Pick<AwinCredentials, 'publisherId' | 'offersApiToken'>>,
  opts?: { fetchImpl?: typeof fetch; regionCodes?: string[]; pageSize?: number },
): Promise<CouponUpsertInput[]> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const regionCodes = opts?.regionCodes ?? ['BR'];
  const publisherId = creds.publisherId;
  const token = creds.offersApiToken;

  const url = `https://api.awin.com/publisher/${publisherId}/promotions`;
  const coupons: CouponUpsertInput[] = [];
  let page = 1;
  const pageSize = opts?.pageSize ?? 200;

  while (true) {
    const body = {
      filters: {
        membership: 'joined',
        type: 'voucher',
        regionCodes,
        status: 'active',
      },
      pagination: {
        page,
        pageSize,
      },
    };

    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new AwinApiError('Token da API de Ofertas da Awin inválido ou não autorizado', 'AWIN_UNAUTHORIZED');
    }

    if (!res.ok) {
      throw new AwinApiError(`Listagem de promoções da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
    }

    const json = await res.json();
    const data = json?.data ?? [];
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const item of data) {
      const coupon = mapAwinPromotion(item);
      if (coupon) coupons.push(coupon);
    }

    const total = json?.pagination?.total ?? 0;
    if (page * pageSize >= total || data.length < pageSize) {
      break;
    }

    page++;
  }

  return coupons;
}
