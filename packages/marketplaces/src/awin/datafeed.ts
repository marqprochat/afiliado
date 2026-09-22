import { parse } from 'csv-parse/sync';
import { parse as parseStream } from 'csv-parse';
import { createGunzip } from 'node:zlib';
import { Readable, pipeline } from 'node:stream';

export class AwinApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'AWIN_UNAUTHORIZED' | 'AWIN_ERROR',
  ) {
    super(message);
    this.name = 'AwinApiError';
  }
}

export type AwinDatafeedFormat = 'Google' | 'Awin';

export interface AwinFeedListEntry {
  advertiserId: string;
  advertiserName: string;
  region: string;
  membershipStatus: string;
  feedId: string;
  feedName: string;
  format: AwinDatafeedFormat;
  productCount: number | null;
  url: string;
}

export interface AwinFeedRow {
  [key: string]: string | undefined;
}

export interface AwinDatafeedOptions {
  fetchImpl?: typeof fetch;
}

function parseProductCount(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca a lista de feeds no link secreto do publisher (contém a API key). Não logar nem
 * devolver `feedListUrl` — o erro nunca inclui a URL.
 */
export async function listDatafeeds(
  feedListUrl: string,
  opts: AwinDatafeedOptions = {},
): Promise<AwinFeedListEntry[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(feedListUrl);
  if (res.status === 401 || res.status === 403) {
    throw new AwinApiError('Link da lista de feeds da Awin inválido ou não autorizado', 'AWIN_UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new AwinApiError(`Listagem de feeds da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  const text = await res.text();
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<
    string,
    string
  >[];
  return rows.map((r) => ({
    advertiserId: r['Advertiser ID'] ?? '',
    advertiserName: r['Advertiser Name'] ?? '',
    region: r['Primary Region'] ?? '',
    membershipStatus: r['Membership Status'] ?? '',
    feedId: r['Feed ID'] ?? '',
    feedName: r['Feed Name'] ?? '',
    format: r['Datafeed Format'] === 'Google' ? 'Google' : 'Awin',
    productCount: parseProductCount(r['No of products']),
    url: r['URL'] ?? '',
  }));
}

/**
 * Baixa o CSV de produtos de um feed, transmitindo as linhas conforme chegam (feeds podem ter
 * 300k+ linhas). O corpo pode vir gzipado como arquivo (não como Content-Encoding) — detecta
 * pelos dois primeiros bytes (`1f 8b`) em vez de confiar na extensão da URL.
 */
export async function downloadFeed(
  feedUrl: string,
  opts: AwinDatafeedOptions = {},
): Promise<AsyncIterable<AwinFeedRow>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(feedUrl);
  if (!res.ok) {
    throw new AwinApiError(`Download do feed da Awin respondeu HTTP ${res.status}`, 'AWIN_ERROR');
  }
  if (!res.body) {
    return (async function* () {})();
  }
  const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream);

  // Peek the first chunk to detect gzip magic bytes without relying on the URL suffix, then
  // push it back so downstream parsing sees the full stream.
  let ended = false;
  const firstChunk: Buffer = await new Promise((resolve, reject) => {
    nodeStream.once('error', reject);
    nodeStream.once('data', (chunk: Buffer) => {
      nodeStream.pause();
      resolve(chunk);
    });
    nodeStream.once('end', () => {
      ended = true;
      resolve(Buffer.alloc(0));
    });
  });

  const isGzip = firstChunk.length >= 2 && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;

  if (!ended && firstChunk.length > 0) nodeStream.unshift(firstChunk);

  const parser = parseStream({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });
  // pipeline (não .pipe) propaga erro de rede/gzip corrompido até o parser — senão o
  // `for await` do import ficaria pendurado para sempre, travando a fila de imports.
  const onError = (err: Error | null) => {
    if (err) parser.destroy(err);
  };
  if (isGzip) pipeline(nodeStream, createGunzip(), parser, onError);
  else pipeline(nodeStream, parser, onError);

  return parser as unknown as AsyncIterable<AwinFeedRow>;
}
