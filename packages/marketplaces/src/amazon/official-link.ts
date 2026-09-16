/**
 * Gerador oficial de links de afiliado da Amazon via SiteStripe.
 *
 * O SiteStripe (barra injetada em páginas de produto para quem está logado como associado)
 * chama https://www.amazon.com.br/associates/sitestripe/getShortUrl com os cookies da sessão
 * para gerar um link curto oficial. Aqui usamos esses cookies (salvos manualmente ou pela
 * extensão) para chamar o mesmo endpoint.
 *
 * O endpoint interno não é documentado e pode mudar — por isso o adapter sempre cai no
 * fallback por tag (?tag=...) em caso de erro.
 */

import { cookieHeader } from '../mercadolivre/official-link';

export const AMAZON_SITESTRIPE_ENDPOINT_DEFAULT =
  'https://www.amazon.com.br/associates/sitestripe/getShortUrl';
export const AMAZON_MARKETPLACE_ID_BR = '526970';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export class AmazonSessionError extends Error {
  constructor(
    message: string,
    public readonly code: 'AMAZON_SESSION_EXPIRED' | 'AMAZON_SITESTRIPE_ERROR',
  ) {
    super(message);
    this.name = 'AmazonSessionError';
  }
}

export interface OfficialAmazonLinkOptions {
  endpoint?: string;
  marketplaceId?: string;
  timeoutMs?: number;
  /** Injetável em testes. */
  fetchImpl?: typeof fetch;
}

function looksLikeLogin(finalUrl: string): boolean {
  return /\/ap\/signin/i.test(finalUrl);
}

/** Procura a primeira URL http(s) em qualquer texto/JSON de resposta. */
export function findFirstUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s"'\\]+/);
  return m?.[0];
}

/**
 * Gera o link curto oficial da Amazon (SiteStripe) para uma URL de produto usando a sessão
 * do afiliado. Lança AmazonSessionError quando a sessão expirou ou o endpoint não respondeu
 * como esperado.
 */
export async function generateOfficialAmazonLink(
  productUrl: string,
  cookies: Record<string, string>,
  storeId: string,
  opts: OfficialAmazonLinkOptions = {},
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? AMAZON_SITESTRIPE_ENDPOINT_DEFAULT;
  const marketplaceId = opts.marketplaceId ?? AMAZON_MARKETPLACE_ID_BR;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const cookie = cookieHeader(cookies);
  if (!cookie) {
    throw new AmazonSessionError('Sessão da Amazon não sincronizada', 'AMAZON_SESSION_EXPIRED');
  }

  const url = new URL(endpoint);
  url.searchParams.set('longUrl', productUrl);
  url.searchParams.set('marketplaceId', marketplaceId);
  url.searchParams.set('storeId', storeId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) {
      throw new AmazonSessionError(
        'Sessão da Amazon expirou; cole o cookie novamente',
        'AMAZON_SESSION_EXPIRED',
      );
    }
    if (!res.ok) {
      throw new AmazonSessionError(
        `SiteStripe respondeu HTTP ${res.status}`,
        'AMAZON_SITESTRIPE_ERROR',
      );
    }
    const text = await res.text();
    const link = findFirstUrl(text);
    if (!link) {
      throw new AmazonSessionError(
        'SiteStripe não devolveu um link válido',
        'AMAZON_SITESTRIPE_ERROR',
      );
    }
    return link;
  } finally {
    clearTimeout(timer);
  }
}
