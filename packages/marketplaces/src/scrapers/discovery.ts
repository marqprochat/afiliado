import * as cheerio from 'cheerio';
import { parseProductUrl } from '@afilados/core';
import { fetchHtml as defaultFetchHtml } from './fetcher';
import { fetchRenderedHtml } from './browser';

const MAX_RESULTS = 20;

export interface DiscoverByKeywordDeps {
  fetchHtml?: (url: string) => Promise<string>;
}

function extractProductUrls(
  html: string,
  baseUrl: string,
  source: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  $('a[href]').each((_, el) => {
    if (urls.length >= MAX_RESULTS) return;
    const href = $(el).attr('href');
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const parsed = parseProductUrl(absolute);
    if (parsed.source !== source) return;
    const dedupeKey = `${parsed.source}:${parsed.externalId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    urls.push(absolute);
  });

  return urls;
}

export async function discoverMercadoLivreByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? ((url: string) => fetchRenderedHtml(url));
  const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'MERCADOLIVRE');
}

export async function discoverAmazonByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(keyword)}`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'AMAZON');
}

export async function discoverMagaluByKeyword(
  keyword: string,
  deps: DiscoverByKeywordDeps = {},
): Promise<string[]> {
  const fetchHtml = deps.fetchHtml ?? ((url: string) => fetchRenderedHtml(url));
  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(keyword)}/`;
  const html = await fetchHtml(url);
  return extractProductUrls(html, url, 'MAGALU');
}
