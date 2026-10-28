import { AwinApiError } from './datafeed';

export interface AwinProgramme {
  id: number;
  name: string;
  displayUrl: string;
  clickThroughUrl?: string | undefined;
  primaryRegion?: {
    countryCode: string;
    name: string;
  } | undefined;
  logoUrl?: string | undefined;
}

export interface AwinPartnerDomain {
  advertiserId: string;
  name: string;
  domain: string;
  displayUrl: string;
}

export interface ListProgrammesOptions {
  fetchImpl?: typeof fetch;
  relationship?: 'joined' | 'pending' | 'suspended' | 'rejected' | 'notJoined';
  countryCode?: string;
}

/**
 * Lista programas (anunciantes) aos quais o afiliado pertence na Awin.
 * Endpoint oficial: GET https://api.awin.com/publishers/{publisherId}/programmes
 */
export async function listAwinProgrammes(
  creds: { publisherId: string; offersApiToken: string },
  opts: ListProgrammesOptions = {},
): Promise<AwinProgramme[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const relationship = opts.relationship ?? 'joined';
  let url = `https://api.awin.com/publishers/${encodeURIComponent(creds.publisherId)}/programmes?relationship=${relationship}`;
  if (opts.countryCode) {
    url += `&countryCode=${encodeURIComponent(opts.countryCode)}`;
  }

  const res = await doFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${creds.offersApiToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError(
      'Token de API da Awin inválido ou não autorizado',
      'AWIN_UNAUTHORIZED',
    );
  }

  if (!res.ok) {
    throw new AwinApiError(
      `Listagem de programas da Awin respondeu HTTP ${res.status}`,
      'AWIN_ERROR',
    );
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item: any) => ({
    id: Number(item.id),
    name: String(item.name || ''),
    displayUrl: String(item.displayUrl || ''),
    ...(item.clickThroughUrl ? { clickThroughUrl: String(item.clickThroughUrl) } : {}),
    ...(item.primaryRegion ? { primaryRegion: item.primaryRegion } : {}),
    ...(item.logoUrl ? { logoUrl: String(item.logoUrl) } : {}),
  }));
}

/**
 * Normaliza uma URL ou string de domínio para hostname limpo (ex: "http://www.drogal.com.br/x" -> "drogal.com.br").
 */
export function extractCleanDomain(rawUrl: string): string {
  if (!rawUrl) return '';
  let str = rawUrl.trim().toLowerCase();
  if (!str.startsWith('http://') && !str.startsWith('https://')) {
    str = `https://${str}`;
  }
  try {
    const parsed = new URL(str);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return str.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]!.split(':')[0]!;
  }
}

/**
 * Mapeia lista de programas para dicionário de domínios indexados por hostname (ex: "drogal.com.br" -> { advertiserId: "68224", name: "Drogal BR" }).
 */
export function mapProgrammesToDomains(
  programmes: AwinProgramme[],
): Record<string, AwinPartnerDomain> {
  const result: Record<string, AwinPartnerDomain> = {};
  for (const prog of programmes) {
    const domain = extractCleanDomain(prog.displayUrl);
    if (domain && domain.includes('.')) {
      result[domain] = {
        advertiserId: String(prog.id),
        name: prog.name,
        domain,
        displayUrl: prog.displayUrl,
      };
    }
  }
  return result;
}

/**
 * Parceiros conhecidos da AWIN Brasil como fallback (ex: Drogal, etc.)
 */
export const DEFAULT_AWIN_PARTNERS: Record<string, AwinPartnerDomain> = {
  'drogal.com.br': {
    advertiserId: '68224',
    name: 'Drogal BR',
    domain: 'drogal.com.br',
    displayUrl: 'https://www.drogal.com.br',
  },
};

/**
 * Constrói o link oficial canônico de deep link com tracking da Awin.
 * Exemplo de saída:
 * https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2F...
 */
export function buildAwinTrackingLink(params: {
  publisherId: string;
  advertiserId: string | number;
  destinationUrl: string;
  subId?: string | null | undefined;
}): string {
  const cleanDestination = params.destinationUrl.trim();
  const ued = encodeURIComponent(cleanDestination);
  let trackingUrl = `https://www.awin1.com/cread.php?awinmid=${params.advertiserId}&awinaffid=${params.publisherId}&platform=dl&ued=${ued}`;
  if (params.subId) {
    trackingUrl += `&clickref=${encodeURIComponent(params.subId)}`;
  }
  return trackingUrl;
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
  const doFetch = opts.fetchImpl ?? fetch;

  if (creds.offersApiToken) {
    try {
      const apiUrl = `https://api.awin.com/publishers/${encodeURIComponent(creds.publisherId)}/linkbuilder/generate`;
      const body: Record<string, any> = {
        advertiserId: Number(params.advertiserId),
        destinationUrl: params.destinationUrl,
        shorten: Boolean(params.shorten),
      };
      if (params.subId) {
        body.parameters = { clickref: params.subId };
      }

      const res = await doFetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.offersApiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const json = (await res.json()) as { url?: string; shortenedUrl?: string };
        const generatedUrl = json.url || json.shortenedUrl;
        if (generatedUrl) {
          return { url: generatedUrl, shortened: Boolean(params.shorten) };
        }
      }
    } catch {
      // Fallback seguro em caso de timeout ou erro de rede
    }
  }

  // Fallback canônico imediato
  const canonicalUrl = buildAwinTrackingLink({
    publisherId: creds.publisherId,
    advertiserId: params.advertiserId,
    destinationUrl: params.destinationUrl,
    subId: params.subId,
  });

  return { url: canonicalUrl, shortened: false };
}
