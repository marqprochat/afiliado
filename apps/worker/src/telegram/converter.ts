import { decryptJson, resolveConnection } from '@afilados/db';
import {
  applyAffiliateTag,
  composeLinkSubIds,
  parseOfferText,
  parseProductUrl,
  resolveShortLinks,
  rewriteLinks,
} from '@afilados/core';
import {
  hasTagCredentials,
  type MarketplaceKind,
  type TagCredentials,
} from '@afilados/shared';
import {
  createShopeeAdapter,
  getAliexpressAdapter,
  getAwinAdapter,
  getTagAdapter,
  type AliexpressCredentials,
  type AwinCredentials,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';

let shopeeAdapter: MarketplaceAdapter<ShopeeCredentials> | null = null;
function getShopee() {
  if (!shopeeAdapter) shopeeAdapter = createShopeeAdapter({ mock: false });
  return shopeeAdapter;
}

export interface ConvertedLinkItem {
  originalUrl: string;
  resolvedUrl: string;
  affiliateUrl: string;
  marketplace: string;
  converted: boolean;
  error?: string | null | undefined;
}

export interface ConvertTextResult {
  originalText: string;
  convertedText: string;
  hasConvertedLink: boolean;
  failureReason?: string | undefined;
  detected: {
    title?: string | undefined;
    price?: number | undefined;
    originalPrice?: number | undefined;
    discountPct?: number | undefined;
    coupon?: string | undefined;
    links: ConvertedLinkItem[];
  };
}

export async function convertOfferText(
  tenantId: string,
  text: string,
): Promise<ConvertTextResult> {
  const parsed = parseOfferText(text);
  const expansions = await resolveShortLinks(text);

  const replacements = new Map<string, string>();
  const convertedLinks: ConvertedLinkItem[] = [];

  for (const rawUrl of parsed.urls) {
    const expandedUrl = expansions.get(rawUrl) ?? rawUrl;
    const productUrl = parseProductUrl(expandedUrl);

    if (productUrl.source === 'UNSUPPORTED') {
      convertedLinks.push({
        originalUrl: rawUrl,
        resolvedUrl: expandedUrl,
        affiliateUrl: rawUrl,
        marketplace: 'UNKNOWN',
        converted: false,
        error: 'Link não reconhecido como marketplace suportado',
      });
      continue;
    }

    const kind = productUrl.source as MarketplaceKind;
    try {
      const resolved = await resolveConnection(tenantId, kind);
      const conn = resolved?.row ?? null;
      const affiliateSubId = resolved?.subId ?? null;

      if (!conn?.encryptedCredentials) {
        convertedLinks.push({
          originalUrl: rawUrl,
          resolvedUrl: expandedUrl,
          affiliateUrl: rawUrl,
          marketplace: kind,
          converted: false,
          error: `${kind}: credenciais não configuradas na sua conta`,
        });
        continue;
      }

      let affiliateUrl: string | null = null;

      if (kind === 'SHOPEE') {
        const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
        const { subId, extraSubIds } = composeLinkSubIds('SHOPEE', affiliateSubId, '');
        affiliateUrl = await getShopee().toAffiliateLink(
          creds,
          expandedUrl,
          subId,
          extraSubIds,
        );
      } else if (kind === 'ALIEXPRESS') {
        const creds = decryptJson<AliexpressCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = composeLinkSubIds('ALIEXPRESS', affiliateSubId, '').subId;
        affiliateUrl = await getAliexpressAdapter().toAffiliateLink(creds, expandedUrl, subId);
      } else if (kind === 'AWIN') {
        const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = composeLinkSubIds('AWIN', affiliateSubId, '').subId;
        affiliateUrl = await getAwinAdapter().toAffiliateLink(creds, expandedUrl, subId);
      } else {
        // AMAZON, MERCADOLIVRE, MAGALU
        const creds = applyAffiliateTag(
          decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials)),
          affiliateSubId,
        );
        const hasMlSession = kind === 'MERCADOLIVRE' && Boolean(creds.mlSession?.cookies);
        if (hasTagCredentials(kind, creds) || hasMlSession) {
          affiliateUrl = await getTagAdapter(kind).toAffiliateLink(creds, expandedUrl);
        } else {
          convertedLinks.push({
            originalUrl: rawUrl,
            resolvedUrl: expandedUrl,
            affiliateUrl: rawUrl,
            marketplace: kind,
            converted: false,
            error: `${kind}: tag de afiliado ausente em Configurações`,
          });
          continue;
        }
      }

      if (affiliateUrl) {
        replacements.set(rawUrl, affiliateUrl);
        convertedLinks.push({
          originalUrl: rawUrl,
          resolvedUrl: expandedUrl,
          affiliateUrl,
          marketplace: kind,
          converted: true,
          error: null,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Falha ao gerar link de afiliado';
      convertedLinks.push({
        originalUrl: rawUrl,
        resolvedUrl: expandedUrl,
        affiliateUrl: rawUrl,
        marketplace: kind,
        converted: false,
        error: errMsg,
      });
    }
  }

  const convertedText = rewriteLinks(text, replacements);
  const hasConvertedLink = convertedLinks.some((l) => l.converted);

  let failureReason: string | undefined;
  if (!hasConvertedLink) {
    if (parsed.urls.length === 0) {
      failureReason = 'Nenhum link encontrado no texto enviado';
    } else {
      const errors = convertedLinks.map((l) => l.error).filter(Boolean);
      failureReason = errors.length > 0 ? errors.join('; ') : 'Não foi possível converter o link para afiliado';
    }
  }

  return {
    originalText: text,
    convertedText,
    hasConvertedLink,
    ...(failureReason ? { failureReason } : {}),
    detected: {
      title: parsed.title,
      price: parsed.price,
      originalPrice: parsed.originalPrice,
      discountPct: parsed.discountPct,
      coupon: parsed.coupon,
      links: convertedLinks,
    },
  };
}
