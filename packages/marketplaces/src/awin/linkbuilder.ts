import { AwinApiError } from './datafeed';
import { buildAwinTrackingLink } from './programmes';

/**
 * Link Builder da Awin (API legada, 20 req/min por usuário). Todas as chamadas vão para
 * `api.awin.com`; links de rastreio (`awin1.com/cread.php`, `pclick.php`) nunca são requisitados.
 */

export interface AwinLinkCreds {
  publisherId: string;
  offersApiToken: string;
}

export type AwinClickrefKey =
  | 'clickref'
  | 'clickref2'
  | 'clickref3'
  | 'clickref4'
  | 'clickref5'
  | 'clickref6';

export type AwinLinkParameters = Partial<Record<AwinClickrefKey | 'campaign', string>>;

export interface AwinLinkRequest {
  advertiserId: number;
  destinationUrl: string;
  parameters?: AwinLinkParameters | undefined;
}

export type AwinBatchLinkResult = { ok: true; url: string } | { ok: false; error: string };

export interface AwinLinkQuota {
  limit: number | null;
  usage: number;
  remaining: number | null;
}

interface FetchOpts {
  fetchImpl?: typeof fetch;
}

/** Máximo de pedidos por chamada de `generate-batch`. */
export const AWIN_LINK_BATCH_SIZE = 100;

const CLICKREF_KEYS: AwinClickrefKey[] = [
  'clickref',
  'clickref2',
  'clickref3',
  'clickref4',
  'clickref5',
  'clickref6',
];

const UNAUTHORIZED_MESSAGE =
  'Token de API da Awin inválido, expirado ou não autorizado (se for um Personal Access Token, confira a validade e renove no painel da Awin)';

function base(publisherId: string): string {
  return `https://api.awin.com/publishers/${encodeURIComponent(publisherId)}/linkbuilder`;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function assertAuthorized(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError(UNAUTHORIZED_MESSAGE, 'AWIN_UNAUTHORIZED');
  }
}

function toBody(r: AwinLinkRequest): Record<string, unknown> {
  const params = r.parameters
    ? Object.fromEntries(Object.entries(r.parameters).filter(([, v]) => Boolean(v)))
    : {};
  return {
    advertiserId: Number(r.advertiserId),
    destinationUrl: r.destinationUrl,
    ...(Object.keys(params).length ? { parameters: params } : {}),
  };
}

function itemError(status: unknown, body: unknown): string {
  const text = JSON.stringify(body ?? '');
  if (/deeplinkNotPermitted/i.test(text)) {
    return 'O anunciante não permite deep link para esta página';
  }
  return `A Awin recusou o link (HTTP ${typeof status === 'number' ? status : '?'})`;
}

/**
 * Gera vários links numa só chamada por bloco de 100 (`generate-batch`). Devolve um resultado por
 * pedido, na mesma ordem. Erro de rede/HTTP no bloco marca todos os itens do bloco como falha;
 * 401/403 propaga `AwinApiError('AWIN_UNAUTHORIZED')`. O lote não gera link curto.
 */
export async function generateAwinLinksBatch(
  creds: AwinLinkCreds,
  requests: AwinLinkRequest[],
  opts: FetchOpts = {},
): Promise<AwinBatchLinkResult[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const out: AwinBatchLinkResult[] = [];
  for (let start = 0; start < requests.length; start += AWIN_LINK_BATCH_SIZE) {
    const chunk = requests.slice(start, start + AWIN_LINK_BATCH_SIZE);
    const failAll = (error: string) => {
      for (let i = 0; i < chunk.length; i++) out.push({ ok: false, error });
    };
    let res: Response;
    try {
      res = await doFetch(`${base(creds.publisherId)}/generate-batch`, {
        method: 'POST',
        headers: headers(creds.offersApiToken),
        body: JSON.stringify({ requests: chunk.map(toBody) }),
      });
    } catch (err) {
      failAll(`Falha de rede ao falar com a Awin: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    assertAuthorized(res);
    if (!res.ok) {
      failAll(`A Awin respondeu HTTP ${res.status} ao gerar os links`);
      continue;
    }
    let data: { responses?: unknown };
    try {
      data = (await res.json()) as { responses?: unknown };
    } catch {
      failAll('Resposta inválida da Awin');
      continue;
    }
    const responses = Array.isArray(data.responses) ? data.responses : [];
    chunk.forEach((_, i) => {
      const r = responses[i] as { status?: unknown; body?: { url?: unknown } } | undefined;
      const url = typeof r?.body?.url === 'string' ? r.body.url : null;
      const status = typeof r?.status === 'number' ? r.status : 200;
      if (r && url && status >= 200 && status < 300) out.push({ ok: true, url });
      else out.push({ ok: false, error: r ? itemError(r.status, r.body) : 'Sem resposta da Awin' });
    });
  }
  return out;
}

/** Cota de links curtos (últimas 24 h): `GET .../linkbuilder/quota`. */
export async function getAwinLinkQuota(
  creds: AwinLinkCreds,
  opts: FetchOpts = {},
): Promise<AwinLinkQuota> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${base(creds.publisherId)}/quota`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${creds.offersApiToken}`, Accept: 'application/json' },
  });
  assertAuthorized(res);
  if (!res.ok) {
    throw new AwinApiError(`Cota de links da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const data = (await res.json()) as { limit?: unknown; usage?: unknown };
  const limit = typeof data.limit === 'number' && Number.isFinite(data.limit) ? data.limit : null;
  const usage = typeof data.usage === 'number' && Number.isFinite(data.usage) ? data.usage : 0;
  return { limit, usage, remaining: limit === null ? null : Math.max(0, limit - usage) };
}

/**
 * Lê um deep link `awin1.com/cread.php` sem requisitá-lo: anunciante (`awinmid`), destino (`ued`) e
 * clickrefs. Qualquer outro formato (ex.: `pclick.php`) → `null`.
 */
export function parseAwinCreadLink(url: string): AwinLinkRequest | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'awin1.com' || u.pathname !== '/cread.php') return null;
  const advertiserId = Number(u.searchParams.get('awinmid'));
  const destinationUrl = u.searchParams.get('ued');
  if (!Number.isInteger(advertiserId) || advertiserId <= 0 || !destinationUrl) return null;
  const parameters: AwinLinkParameters = {};
  for (const key of [...CLICKREF_KEYS, 'campaign'] as const) {
    const v = u.searchParams.get(key);
    if (v) parameters[key] = v;
  }
  return {
    advertiserId,
    destinationUrl,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  };
}

/**
 * Gera um link individual (`generate`). Com `shorten`, a Awin devolve também `shortUrl` (tidd.ly),
 * que consome a cota diária. Erros viram `AwinApiError`.
 */
export async function generateAwinLink(
  creds: AwinLinkCreds,
  request: AwinLinkRequest,
  opts: FetchOpts & { shorten?: boolean } = {},
): Promise<{ url: string; shortUrl: string | null }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${base(creds.publisherId)}/generate`, {
    method: 'POST',
    headers: headers(creds.offersApiToken),
    body: JSON.stringify({ ...toBody(request), shorten: Boolean(opts.shorten) }),
  });
  assertAuthorized(res);
  if (!res.ok) {
    throw new AwinApiError(`Link Builder da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const data = (await res.json()) as { url?: unknown; shortUrl?: unknown };
  if (typeof data.url !== 'string') {
    throw new AwinApiError('Link Builder da Awin não devolveu o link', 'AWIN_ERROR');
  }
  return { url: data.url, shortUrl: typeof data.shortUrl === 'string' ? data.shortUrl : null };
}

/**
 * Gera o link com tracking através da API oficial da Awin (Link Builder API).
 * Endpoint: POST https://api.awin.com/publishers/{publisherId}/linkbuilder/generate
 * Se a chamada falhar (por exemplo, rate limit de 20 req/min ou token ausente),
 * cai no fallback canônico buildAwinTrackingLink.
 */
export async function generateAwinTrackingLinkViaApi(
  creds: { publisherId: string; offersApiToken?: string | undefined },
  params: {
    advertiserId: string | number;
    destinationUrl: string;
    subId?: string | null | undefined;
    shorten?: boolean | undefined;
  },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ url: string; shortened: boolean }> {
  if (creds.offersApiToken) {
    try {
      const res = await generateAwinLink(
        { publisherId: creds.publisherId, offersApiToken: creds.offersApiToken },
        {
          advertiserId: Number(params.advertiserId),
          destinationUrl: params.destinationUrl,
          ...(params.subId ? { parameters: { clickref: params.subId } } : {}),
        },
        { shorten: Boolean(params.shorten), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) },
      );
      if (params.shorten && res.shortUrl) return { url: res.shortUrl, shortened: true };
      return { url: res.url, shortened: false };
    } catch {
      // Fallback seguro em caso de timeout, erro de rede ou token inválido
    }
  }

  return {
    url: buildAwinTrackingLink({
      publisherId: creds.publisherId,
      advertiserId: params.advertiserId,
      destinationUrl: params.destinationUrl,
      subId: params.subId,
    }),
    shortened: false,
  };
}
