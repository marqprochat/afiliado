import type { AliexpressCredentials } from '../adapter';
import type { CouponUpsertInput } from '../coupons';
import { AliexpressClient } from './client';

export function mapPromoCodeInfo(product: any): CouponUpsertInput | null {
  const promo = product?.promo_code_info;
  if (!promo || !promo.promo_code || typeof promo.promo_code !== 'string') return null;
  const rawCode = promo.promo_code.trim();
  if (!rawCode) return null;

  const campaignType = String(promo.code_campaigntype ?? '');
  const discountType = campaignType === '1' ? 'FIXED' : campaignType === '2' ? 'PERCENT' : null;

  // Extrair valor numérico de code_value
  let discountValue: number | null = null;
  if (promo.code_value) {
    const str = String(promo.code_value);
    const m =
      str.match(/(?:get|ganhe|desconto\s+de)\s*(?:BRL|R\$|\$)?\s*([\d.,]+)/i) ??
      str.match(/([\d.,]+)\s*%\s*(?:off|de\s+desconto)?/i) ??
      str.match(/([\d.,]+)\s*(?:off|de\s+desconto)/i) ??
      str.match(/(?:BRL|R\$|\$)\s*([\d.,]+)/i);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(val)) discountValue = val;
    }
  }

  let minSpend: number | null = null;
  if (promo.code_mini_spend) {
    const val = parseFloat(String(promo.code_mini_spend).replace(',', '.'));
    if (!isNaN(val)) minSpend = val;
  }

  const parseAliDate = (dStr?: string) => {
    if (!dStr) return null;
    const clean = dStr.trim().replace(' ', 'T');
    const d = new Date(clean + 'Z');
    return isNaN(d.getTime()) ? null : d;
  };

  const startsAt = parseAliDate(promo.code_availabletime_start);
  const expiresAt = parseAliDate(promo.code_availabletime_end);

  const remainingUses = promo.code_quantity ? parseInt(String(promo.code_quantity), 10) : null;

  return {
    store: 'ALIEXPRESS',
    scope: '',
    advertiserName: null,
    code: rawCode.toUpperCase(),
    description: promo.code_value ? String(promo.code_value).trim() : 'Cupom AliExpress',
    terms: null,
    discountType,
    discountValue,
    minSpend,
    startsAt,
    expiresAt,
    sourceUrl: product.product_detail_url ?? null,
    affiliateUrl: promo.code_promotionurl ?? null,
    externalId: product.product_id ? String(product.product_id) : null,
    remainingUses: isNaN(Number(remainingUses)) ? null : remainingUses,
  };
}

export async function fetchAliexpressPromoCodes(
  creds: AliexpressCredentials,
  opts?: {
    keywords?: string[];
    maxPages?: number;
    pageSize?: number;
    client?: AliexpressClient;
  },
): Promise<CouponUpsertInput[]> {
  const client = opts?.client ?? new AliexpressClient(creds);
  const keywords = opts?.keywords && opts.keywords.length > 0 ? opts.keywords : ['promo'];
  const maxPages = opts?.maxPages ?? 2;
  const pageSize = opts?.pageSize ?? 50;

  const couponsByCode = new Map<string, CouponUpsertInput>();

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const res = await client.execute<any>('aliexpress.affiliate.product.query', {
          keywords: kw,
          page_no: page,
          page_size: pageSize,
          target_currency: 'BRL',
          target_language: 'PT',
          ship_to_country: 'BR',
          fields: 'commission_rate,sale_price,product_id,product_title,product_detail_url,target_sale_price,promo_code_info',
        });

        const products =
          res?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ??
          res?.resp_result?.result?.products?.product ??
          [];

        if (!Array.isArray(products) || products.length === 0) break;

        for (const p of products) {
          const coupon = mapPromoCodeInfo(p);
          if (!coupon) continue;

          const existing = couponsByCode.get(coupon.code);
          if (!existing) {
            couponsByCode.set(coupon.code, coupon);
          } else {
            // Mantém o de maior validade
            const existingExp = existing.expiresAt?.getTime() ?? 0;
            const newExp = coupon.expiresAt?.getTime() ?? 0;
            if (newExp > existingExp) {
              couponsByCode.set(coupon.code, coupon);
            }
          }
        }
      } catch {
        // Se uma keyword falhar, continua para a próxima
        break;
      }
    }
  }

  return Array.from(couponsByCode.values());
}
