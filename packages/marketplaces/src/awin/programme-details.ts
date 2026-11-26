import { AwinApiError } from './datafeed';

/** Indicadores de um programa da Awin (`programmedetails`), normalizados. */
export interface AwinProgrammeDetails {
  advertiserId: string;
  name: string;
  logoUrl: string | null;
  displayUrl: string | null;
  currency: string | null;
  epc: number | null;
  conversionRate: number | null;
  approvalPercentage: number | null;
  /** Dias. */
  averagePaymentTime: number | null;
  validationDays: number | null;
  awinIndex: number | null;
  commissionMin: number | null;
  commissionMax: number | null;
  commissionType: string | null;
}

/** Limite da API legada da Awin: 20 chamadas/min por usuário → 3,1 s entre chamadas. */
export const AWIN_LEGACY_API_INTERVAL_MS = 3_100;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/**
 * Normaliza a resposta de `programmedetails`. Tolerante: números podem vir como string e campos
 * ausentes viram `null`. Sem id (nem o de reserva) → `null`.
 */
export function mapAwinProgrammeDetails(
  raw: unknown,
  fallbackAdvertiserId?: string | number,
): AwinProgrammeDetails | null {
  if (!isObj(raw)) return null;
  const info = isObj(raw.programmeInfo) ? raw.programmeInfo : {};
  const kpi = isObj(raw.kpi) ? raw.kpi : {};
  const advertiserId = str(info.id) ?? str(fallbackAdvertiserId);
  if (!advertiserId) return null;

  const ranges = Array.isArray(raw.commissionRange) ? raw.commissionRange.filter(isObj) : [];
  const mins = ranges.map((r) => num(r.min)).filter((n): n is number => n !== null);
  const maxs = ranges.map((r) => num(r.max)).filter((n): n is number => n !== null);

  return {
    advertiserId,
    name: str(info.name) ?? advertiserId,
    logoUrl: str(info.logoUrl),
    displayUrl: str(info.displayUrl),
    currency: str(info.currencyCode)?.toUpperCase() ?? null,
    epc: num(kpi.epc),
    conversionRate: num(kpi.conversionRate),
    approvalPercentage: num(kpi.approvalPercentage),
    averagePaymentTime: int(kpi.averagePaymentTime),
    validationDays: int(kpi.validationDays),
    awinIndex: num(kpi.awinIndex),
    commissionMin: mins.length ? Math.min(...mins) : null,
    commissionMax: maxs.length ? Math.max(...maxs) : null,
    commissionType: ranges.length ? str(ranges[0]!.type) : null,
  };
}

/**
 * `GET https://api.awin.com/publishers/{id}/programmedetails?advertiserId=…&relationship=joined`.
 * 401/403 → `AwinApiError('AWIN_UNAUTHORIZED')`.
 */
export async function getAwinProgrammeDetails(
  creds: { publisherId: string; offersApiToken: string },
  advertiserId: string | number,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<AwinProgrammeDetails | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const qs = new URLSearchParams({ advertiserId: String(advertiserId), relationship: 'joined' });
  const url = `https://api.awin.com/publishers/${encodeURIComponent(creds.publisherId)}/programmedetails?${qs}`;
  const res = await doFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${creds.offersApiToken}`, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError(
      'Token de API da Awin inválido, expirado ou não autorizado (se for um Personal Access Token, confira a validade e renove no painel da Awin)',
      'AWIN_UNAUTHORIZED',
    );
  }
  if (!res.ok) {
    throw new AwinApiError(
      `Detalhes do programa da Awin responderam HTTP ${res.status}`,
      'AWIN_ERROR',
    );
  }
  return mapAwinProgrammeDetails(await res.json(), advertiserId);
}
