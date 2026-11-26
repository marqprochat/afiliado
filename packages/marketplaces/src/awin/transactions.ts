import { AwinApiError } from './datafeed';

export type AwinTransactionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'DELETED';

/** Transação da Awin normalizada (compatível com `AffiliateSaleInput` de @afilados/db). */
export interface AwinTransaction {
  externalId: string;
  advertiserId: string;
  advertiserName: string | null;
  saleAmount: number;
  commissionAmount: number;
  currency: string;
  status: AwinTransactionStatus;
  transactionDate: Date;
  validationDate: Date | null;
  clickRef: string | null;
  clickRef2: string | null;
  clickRef3: string | null;
  clickRef4: string | null;
  clickRef5: string | null;
  clickRef6: string | null;
  raw: unknown;
}

export interface MapAwinTransactionOptions {
  /** Data usada quando a transação não traz `transactionDate` (alguns webhooks). */
  now?: Date;
}

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

/** Valor monetário: número, string numérica ou `{ amount, currency }`. */
function money(v: unknown): { amount: number | null; currency: string | null } {
  if (isObj(v)) return { amount: num(v.amount ?? v.value), currency: str(v.currency) };
  return { amount: num(v), currency: null };
}

/** Datas da Awin vêm sem fuso quando pedimos `timezone=UTC`: sem offset = UTC. */
function date(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = str(v);
  if (!s) return null;
  let iso = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function status(v: unknown): AwinTransactionStatus {
  switch (str(v)?.toLowerCase()) {
    case 'approved':
      return 'APPROVED';
    case 'declined':
      return 'DECLINED';
    case 'deleted':
      return 'DELETED';
    default:
      return 'PENDING';
  }
}

/** `clickRefs.clickRefN` (API) ou `clickRefN`/`clickrefN` achatados (webhook/variações). */
function clickRef(raw: Obj, n: number): string | null {
  const suffix = n === 1 ? '' : String(n);
  const nested = isObj(raw.clickRefs) ? raw.clickRefs : isObj(raw.clickrefs) ? raw.clickrefs : null;
  const keys = [`clickRef${suffix}`, `clickref${suffix}`, `ClickRef${suffix}`];
  if (n === 1) keys.push('clickRef1', 'clickref1');
  for (const k of keys) {
    const v = str(nested?.[k]) ?? str(raw[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Normaliza uma transação da Awin. Tolerante: os campos da API de transações e das "Transaction
 * notifications" não são totalmente documentados. Sem identificador → `null`.
 */
export function mapAwinTransaction(
  raw: unknown,
  opts: MapAwinTransactionOptions = {},
): AwinTransaction | null {
  if (!isObj(raw)) return null;
  const externalId = str(raw.id) ?? str(raw.transactionId) ?? str(raw.transaction_id);
  if (!externalId) return null;

  const advertiser = isObj(raw.advertiser) ? raw.advertiser : null;
  const advertiserId =
    str(raw.advertiserId) ??
    str(raw.merchantId) ??
    str(advertiser?.id) ??
    str(raw.advertiser_id) ??
    '';
  const advertiserName =
    str(raw.advertiserName) ?? str(raw.merchantName) ?? str(advertiser?.name) ?? null;

  const sale = money(raw.saleAmount ?? raw.sale_amount ?? raw.amount);
  const commission = money(raw.commissionAmount ?? raw.commission ?? raw.commission_amount);
  const currency = sale.currency ?? commission.currency ?? str(raw.currency) ?? 'BRL';

  return {
    externalId,
    advertiserId,
    advertiserName,
    saleAmount: sale.amount ?? 0,
    commissionAmount: commission.amount ?? 0,
    currency: currency.toUpperCase(),
    status: status(raw.commissionStatus ?? raw.status ?? raw.transactionStatus),
    transactionDate:
      date(raw.transactionDate ?? raw.transactionTime ?? raw.date) ?? opts.now ?? new Date(),
    validationDate: date(raw.validationDate),
    clickRef: clickRef(raw, 1),
    clickRef2: clickRef(raw, 2),
    clickRef3: clickRef(raw, 3),
    clickRef4: clickRef(raw, 4),
    clickRef5: clickRef(raw, 5),
    clickRef6: clickRef(raw, 6),
    raw,
  };
}

function tryJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Corpo do webhook → transações. Aceita uma transação, uma lista ou envelopes comuns
 * (`transactions`, `transaction`, `data`, inclusive JSON em string). Nada válido → `[]`.
 */
export function parseAwinWebhookBody(
  body: unknown,
  opts: MapAwinTransactionOptions = {},
): AwinTransaction[] {
  const parsed = tryJson(body);
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (isObj(parsed)) {
    const envelope = tryJson(parsed.transactions ?? parsed.transaction ?? parsed.data);
    if (Array.isArray(envelope)) items = envelope;
    else if (isObj(envelope)) items = [envelope];
    else items = [parsed];
  } else {
    items = [];
  }
  return items
    .map((i) => mapAwinTransaction(tryJson(i), opts))
    .filter((t): t is AwinTransaction => t !== null);
}

/** `yyyy-MM-ddTHH:mm:ss` em UTC (formato da API de transações). */
export function formatAwinDate(d: Date): string {
  return d.toISOString().slice(0, 19);
}

export const AWIN_TRANSACTIONS_MAX_DAYS = 31;

export interface ListAwinTransactionsParams {
  startDate: Date;
  endDate: Date;
  dateType?: 'transaction' | 'validation';
}

/**
 * `GET https://api.awin.com/publishers/{id}/transactions/` (janela ≤ 31 dias, datas em UTC).
 * 401/403 → `AwinApiError('AWIN_UNAUTHORIZED')`.
 */
export async function listAwinTransactions(
  creds: { publisherId: string; offersApiToken: string },
  params: ListAwinTransactionsParams,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<AwinTransaction[]> {
  const span = params.endDate.getTime() - params.startDate.getTime();
  if (span <= 0) throw new Error('janela de transações inválida: endDate deve ser após startDate');
  if (span > AWIN_TRANSACTIONS_MAX_DAYS * 86_400_000) {
    throw new Error(`a Awin aceita no máximo ${AWIN_TRANSACTIONS_MAX_DAYS} dias por consulta`);
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const qs = new URLSearchParams({
    startDate: formatAwinDate(params.startDate),
    endDate: formatAwinDate(params.endDate),
    timezone: 'UTC',
    dateType: params.dateType ?? 'transaction',
  });
  const url = `https://api.awin.com/publishers/${encodeURIComponent(creds.publisherId)}/transactions/?${qs}`;
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
    throw new AwinApiError(`Transações da Awin responderam HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const json: unknown = await res.json();
  const list = Array.isArray(json)
    ? json
    : isObj(json) && Array.isArray(json.transactions)
      ? json.transactions
      : isObj(json) && Array.isArray(json.data)
        ? json.data
        : [];
  const mapOpts = opts.now ? { now: opts.now } : {};
  return list
    .map((t) => mapAwinTransaction(t, mapOpts))
    .filter((t): t is AwinTransaction => t !== null);
}
