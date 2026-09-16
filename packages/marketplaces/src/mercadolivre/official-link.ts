/**
 * Gerador oficial de links de afiliado do Mercado Livre (meli.la).
 *
 * O painel de afiliados (https://www.mercadolivre.com.br/afiliados/linkbuilder) só funciona
 * logado. A extensão Afilados Connect sincroniza os cookies da sessão do usuário; aqui usamos
 * esses cookies para chamar o mesmo endpoint que o painel usa e obter o link curto oficial.
 *
 * O endpoint interno não é documentado e pode mudar — por isso é configurável via
 * ML_LINKBUILDER_ENDPOINT e o adapter sempre cai no fallback matt_word/matt_tool em caso de erro.
 */

export const ML_LINKBUILDER_PAGE = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
export const ML_LINKBUILDER_ENDPOINT_DEFAULT =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export class MlSessionError extends Error {
  constructor(
    message: string,
    public readonly code: 'ML_SESSION_EXPIRED' | 'ML_LINKBUILDER_ERROR',
  ) {
    super(message);
    this.name = 'MlSessionError';
  }
}

export interface OfficialLinkOptions {
  endpoint?: string;
  timeoutMs?: number;
  /** Injetável em testes. */
  fetchImpl?: typeof fetch;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** Extrai o token CSRF do HTML do painel, quando presente. */
export function extractCsrfToken(html: string): string | undefined {
  const patterns = [
    /"csrfToken"\s*:\s*"([^"]+)"/,
    /"csrf_token"\s*:\s*"([^"]+)"/,
    /name=["']_csrf["']\s+(?:value|content)=["']([^"']+)["']/,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Procura recursivamente o primeiro link curto meli.la em qualquer resposta JSON. */
export function findMeliLink(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const m = value.match(/https?:\/\/meli\.la\/[A-Za-z0-9_-]+/);
    return m?.[0];
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findMeliLink(v);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findMeliLink(v);
      if (found) return found;
    }
  }
  return undefined;
}

function looksLikeLogin(finalUrl: string): boolean {
  return /\/(login|registration|jms\/mlb\/lgz)/i.test(finalUrl);
}

/**
 * Gera o link oficial meli.la para uma URL de produto usando a sessão do afiliado.
 * Lança MlSessionError quando a sessão expirou ou o endpoint não respondeu como esperado.
 */
export async function generateOfficialMlLink(
  productUrl: string,
  cookies: Record<string, string>,
  opts: OfficialLinkOptions = {},
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint =
    opts.endpoint ?? process.env.ML_LINKBUILDER_ENDPOINT ?? ML_LINKBUILDER_ENDPOINT_DEFAULT;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const cookie = cookieHeader(cookies);
  if (!cookie) {
    throw new MlSessionError('Sessão do Mercado Livre não sincronizada', 'ML_SESSION_EXPIRED');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 1. Abre o painel para validar a sessão e obter o CSRF
    const page = await doFetch(ML_LINKBUILDER_PAGE, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Cookie: cookie, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    if (looksLikeLogin(page.url)) {
      throw new MlSessionError(
        'Sessão do Mercado Livre expirou; sincronize pela extensão',
        'ML_SESSION_EXPIRED',
      );
    }
    const csrf = extractCsrfToken(await page.text());

    // 2. Chama o gerador
    const res = await doFetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.mercadolivre.com.br',
        Referer: ML_LINKBUILDER_PAGE,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: JSON.stringify({ urls: [productUrl], tag: '' }),
    });
    if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) {
      throw new MlSessionError(
        'Sessão do Mercado Livre expirou; sincronize pela extensão',
        'ML_SESSION_EXPIRED',
      );
    }
    if (!res.ok) {
      throw new MlSessionError(
        `Gerador de links do ML respondeu HTTP ${res.status}`,
        'ML_LINKBUILDER_ERROR',
      );
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const link = findMeliLink(parsed);
    if (!link) {
      throw new MlSessionError(
        'Gerador de links do ML não devolveu um link meli.la',
        'ML_LINKBUILDER_ERROR',
      );
    }
    return link;
  } finally {
    clearTimeout(timer);
  }
}
