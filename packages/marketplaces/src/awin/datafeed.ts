import { parse } from 'csv-parse/sync';

const DATAFEED_LIST_BASE_DEFAULT =
  process.env.AWIN_DATAFEED_LIST_URL ?? 'https://productdata.awin.com/datafeed/list/apikey';

export class AwinApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'AWIN_UNAUTHORIZED' | 'AWIN_ERROR',
  ) {
    super(message);
    this.name = 'AwinApiError';
  }
}

export interface AwinFeedListEntry {
  advertiserId: string;
  advertiserName: string;
  feedId: string;
  feedName: string;
  url: string;
}

export interface AwinFeedRow {
  [key: string]: string | undefined;
}

export interface AwinDatafeedOptions {
  fetchImpl?: typeof fetch;
  listBaseUrl?: string;
}

export async function listDatafeeds(
  datafeedApiKey: string,
  opts: AwinDatafeedOptions = {},
): Promise<AwinFeedListEntry[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.listBaseUrl ?? DATAFEED_LIST_BASE_DEFAULT;
  const res = await doFetch(`${base}/${datafeedApiKey}`);
  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError('Datafeed API key inválida', 'AWIN_UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new AwinApiError(`Listagem de feeds da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const text = await res.text();
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<
    string,
    string
  >[];
  return rows.map((r) => ({
    advertiserId: r['Advertiser ID'] ?? '',
    advertiserName: r['Advertiser Name'] ?? '',
    feedId: r['Feed ID'] ?? '',
    feedName: r['Feed Name'] ?? '',
    url: r['URL'] ?? '',
  }));
}

export async function downloadFeed(
  feedUrl: string,
  opts: AwinDatafeedOptions = {},
): Promise<AwinFeedRow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(feedUrl);
  if (!res.ok) {
    throw new AwinApiError(`Download do feed da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as AwinFeedRow[];
}
