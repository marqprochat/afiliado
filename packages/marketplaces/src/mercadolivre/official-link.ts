/**
 * Gerador oficial de links de afiliado do Mercado Livre (meli.la).
 *
 * O painel de afiliados (https://www.mercadolivre.com.br/afiliados/linkbuilder) só funciona
 * logado. A extensão Afilados Connect sincroniza os cookies da sessão do usuário; aqui usamos
 * esses cookies para chamar o mesmo endpoint que o painel usa e obter o link curto oficial.
 *
 * O endpoint interno não é documentado e pode mudar — por isso é configurável via
 * ML_LINKBUILDER_ENDPOINT e o adapter sempre cai no fallback matt_word/matt_tool em caso de erro.
 *
 * Há dois métodos: `generateOfficialMlLinks` (método 1) gera várias URLs por chamada, em lotes de
 * 20; `generateOfficialMlLink` (método 2) gera uma URL por vez e é o fallback quando o lote falha.
 */

export const ML_LINKBUILDER_PAGE = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
export const ML_LINKBUILDER_ENDPOINT_DEFAULT =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

/** O gerador aceita várias URLs por chamada; o workflow de referência usa lotes de 20. */
export const ML_LINKBUILDER_BATCH_SIZE = 20;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const MELI_LINK_RE = /https?:\/\/meli\.la\/[A-Za-z0-9_-]+/;

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
  /** Etiqueta de afiliado do ML; vazia/ausente = etiqueta padrão da conta. */
  tag?: string | undefined;
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

function sessionExpired(): MlSessionError {
  return new MlSessionError(
    'Sessão do Mercado Livre expirou; sincronize pela extensão',
    'ML_SESSION_EXPIRED',
  );
}

function resolveRequestOptions(cookies: Record<string, string>, opts: OfficialLinkOptions) {
  const cookie = cookieHeader(cookies);
  if (!cookie) {
    throw new MlSessionError('Sessão do Mercado Livre não sincronizada', 'ML_SESSION_EXPIRED');
  }
  return {
    cookie,
    doFetch: opts.fetchImpl ?? fetch,
    endpoint:
      opts.endpoint ?? process.env.ML_LINKBUILDER_ENDPOINT ?? ML_LINKBUILDER_ENDPOINT_DEFAULT,
    timeoutMs: opts.timeoutMs ?? 10_000,
  };
}

interface RawResponse {
  status: number;
  ok: boolean;
  url: string;
  text: string;
}

/** Uma requisição com timeout próprio que cobre também a leitura do corpo. */
async function timedRequest(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<RawResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, ok: res.ok, url: res.url, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** Abre o painel para validar a sessão e obter o CSRF (quando presente). */
async function openLinkbuilder(
  doFetch: typeof fetch,
  cookie: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const page = await timedRequest(
    doFetch,
    ML_LINKBUILDER_PAGE,
    {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Cookie: cookie, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    },
    timeoutMs,
  );
  if (looksLikeLogin(page.url)) throw sessionExpired();
  return extractCsrfToken(page.text);
}

function postCreateLink(
  doFetch: typeof fetch,
  endpoint: string,
  cookie: string,
  csrf: string | undefined,
  urls: string[],
  tag: string,
  timeoutMs: number,
): Promise<RawResponse> {
  return timedRequest(
    doFetch,
    endpoint,
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.mercadolivre.com.br',
        Referer: ML_LINKBUILDER_PAGE,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: JSON.stringify({ urls, tag }),
    },
    timeoutMs,
  );
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Gera o link oficial meli.la para uma URL de produto usando a sessão do afiliado (método 2: uma URL
 * por chamada). Lança MlSessionError quando a sessão expirou ou o endpoint não respondeu como esperado.
 */
export async function generateOfficialMlLink(
  productUrl: string,
  cookies: Record<string, string>,
  opts: OfficialLinkOptions = {},
): Promise<string> {
  const { cookie, doFetch, endpoint, timeoutMs } = resolveRequestOptions(cookies, opts);
  const csrf = await openLinkbuilder(doFetch, cookie, timeoutMs);
  const res = await postCreateLink(
    doFetch,
    endpoint,
    cookie,
    csrf,
    [productUrl],
    opts.tag ?? '',
    timeoutMs,
  );
  if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) throw sessionExpired();
  if (!res.ok) {
    throw new MlSessionError(
      `Gerador de links do ML respondeu HTTP ${res.status}`,
      'ML_LINKBUILDER_ERROR',
    );
  }
  const link = findMeliLink(parseBody(res.text));
  if (!link) {
    throw new MlSessionError(
      'Gerador de links do ML não devolveu um link meli.la',
      'ML_LINKBUILDER_ERROR',
    );
  }
  return link;
}

export interface BatchLinkOptions extends OfficialLinkOptions {
  /** Pausa entre lotes de 20 (padrão 2,5 s); injetável em testes. */
  pauseMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface BatchLinkResult {
  /** URL enviada → link meli.la. URLs que o gerador não resolveu ficam de fora. */
  links: Map<string, string>;
  /** Lotes inteiros que falharam (HTTP de erro, resposta fora do formato…). */
  failures: { urls: string[]; message: string }[];
}

function normalizeForMatch(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname}${x.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function readEntries(parsed: unknown): { origin: string; short: string | undefined }[] {
  const list =
    parsed && typeof parsed === 'object' ? (parsed as { urls?: unknown }).urls : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((e: unknown) => {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const origin =
      typeof o.origin_url === 'string' ? o.origin_url : typeof o.url === 'string' ? o.url : '';
    const short =
      typeof o.short_url === 'string' ? o.short_url.match(MELI_LINK_RE)?.[0] : undefined;
    return { origin, short };
  });
}

/**
 * Método 1: gera os links de várias URLs de uma vez (até 20 por chamada), abrindo o painel uma única
 * vez. Um lote que falha não derruba os outros: vai para `failures` e quem chamou decide o fallback
 * (método 2). Sessão expirada interrompe tudo com `MlSessionError('ML_SESSION_EXPIRED')`.
 */
export async function generateOfficialMlLinks(
  urls: string[],
  cookies: Record<string, string>,
  opts: BatchLinkOptions = {},
): Promise<BatchLinkResult> {
  const links = new Map<string, string>();
  const failures: BatchLinkResult['failures'] = [];
  const unique = [...new Set(urls)];
  const { cookie, doFetch, endpoint, timeoutMs } = resolveRequestOptions(cookies, opts);
  if (unique.length === 0) return { links, failures };

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pauseMs = opts.pauseMs ?? 2500;
  const tag = opts.tag ?? '';
  const csrf = await openLinkbuilder(doFetch, cookie, timeoutMs);

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ML_LINKBUILDER_BATCH_SIZE) {
    chunks.push(unique.slice(i, i + ML_LINKBUILDER_BATCH_SIZE));
  }

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) await sleep(pauseMs);
    try {
      const res = await postCreateLink(doFetch, endpoint, cookie, csrf, chunk, tag, timeoutMs);
      if (res.status === 401 || res.status === 403 || looksLikeLogin(res.url)) {
        throw sessionExpired();
      }
      if (!res.ok) {
        failures.push({
          urls: chunk,
          message: `Gerador de links do ML respondeu HTTP ${res.status}`,
        });
        continue;
      }
      const parsed = parseBody(res.text);
      const entries = readEntries(parsed);
      if (entries.length === 0) {
        const single = chunk.length === 1 ? findMeliLink(parsed) : undefined;
        if (single) links.set(chunk[0]!, single);
        else {
          failures.push({
            urls: chunk,
            message: 'Gerador de links do ML não devolveu a lista de links',
          });
        }
        continue;
      }
      const byNormalized = new Map(chunk.map((u) => [normalizeForMatch(u), u] as const));
      for (const { origin, short } of entries) {
        const sent = chunk.includes(origin) ? origin : byNormalized.get(normalizeForMatch(origin));
        if (sent && short) links.set(sent, short);
      }
    } catch (err) {
      if (err instanceof MlSessionError) throw err;
      failures.push({ urls: chunk, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { links, failures };
}
