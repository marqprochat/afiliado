import { extractUrls } from '@afilados/core';

export const SHORTENER_HOSTS = new Set([
  'meli.la',
  'amzn.to',
  'a.co',
  's.shopee.com.br',
  'shope.ee',
  's.click.aliexpress.com',
  'a.aliexpress.com',
]);

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;

function isSafeHop(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host.includes(':')) return false; // IPv6 literal (inclui ::1)
  if (PRIVATE_HOST_RE.test(host)) return false;
  return true;
}

export interface ResolveShortLinksDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxHops?: number;
}

export async function resolveShortLinks(
  text: string,
  deps: ResolveShortLinksDeps = {},
): Promise<Map<string, string>> {
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxHops = deps.maxHops ?? 3;

  const candidates = new Set<string>();
  for (const raw of extractUrls(text)) {
    try {
      const u = new URL(raw);
      if (SHORTENER_HOSTS.has(u.hostname.replace(/^www\./, ''))) candidates.add(raw);
    } catch {
      // URL inválida: ignora
    }
  }

  const out = new Map<string, string>();
  if (candidates.size === 0) return out;

  for (const shortUrl of candidates) {
    const expanded = await resolveOne(shortUrl, fetchImpl, timeoutMs, maxHops);
    if (expanded) out.set(shortUrl, expanded);
  }
  return out;
}

async function resolveOne(
  startUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxHops: number,
): Promise<string | undefined> {
  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    return undefined;
  }
  if (!isSafeHop(current)) return undefined;

  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
    void res.body?.cancel?.().catch(() => {});

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return undefined;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return undefined;
      }
      if (!isSafeHop(next)) return undefined;
      const nextHost = next.hostname.replace(/^www\./, '');
      if (!SHORTENER_HOSTS.has(nextHost)) {
        // Saiu do domínio do encurtador: já é a URL final, não precisa confirmar com outra requisição.
        return next.toString();
      }
      current = next;
      continue;
    }

    if (res.status >= 200 && res.status < 300) {
      return current.toString();
    }

    return undefined;
  }
  return undefined; // estourou maxHops sem chegar a uma resposta final
}
