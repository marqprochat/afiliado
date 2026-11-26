import { createHash } from 'node:crypto';
import { assertPublicHttpUrl, type LookupAll } from '@afilados/core/safe-url';

/**
 * Imagem substituta para produtos da Awin cujo feed aponta para imagens que saíram do ar.
 *
 * Caso real: o feed da Drogal (anunciante 68224) ainda aponta para `io.convertiez.com.br`, que dá
 * 404 em tudo depois da migração da loja para a VTEX. O link de afiliado da Awin redireciona para
 * a página do produto na loja (`…/<slug>/p`), e o catálogo público da VTEX devolve as imagens
 * atuais a partir desse slug.
 */

export interface ImageFallbackCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface ImageFallbackDeps {
  fetchImpl?: typeof fetch;
  /** Teto de cada requisição. */
  timeoutMs?: number;
  /** DNS injetável (testes); usado pelo guarda anti-SSRF. */
  lookup?: LookupAll;
  cache?: ImageFallbackCache;
}

export type FallbackImageStatus = 'alive' | 'resolved' | 'unresolved';

export interface FallbackImageResult {
  /** Imagem a exibir: a original se está no ar, a substituta se achou, senão a original mesmo. */
  url: string | null;
  status: FallbackImageStatus;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
export const IMAGE_HIT_TTL_SECONDS = 7 * 24 * 3600;
export const IMAGE_MISS_TTL_SECONDS = 24 * 3600;
const ALIVE_PREFIX = 'awin-img:alive:';
const RESOLVED_PREFIX = 'awin-img:resolved:';
const MISS = '-';

const hash = (s: string) => createHash('sha1').update(s).digest('hex');
export const imageAliveCacheKey = (url: string) => `${ALIVE_PREFIX}${hash(url)}`;
const resolvedCacheKey = (imageUrl: string | null, deepLink: string) =>
  `${RESOLVED_PREFIX}${hash(`${imageUrl ?? ''}|${deepLink}`)}`;

async function isPublicUrl(raw: string, lookup?: LookupAll): Promise<URL | null> {
  try {
    return lookup ? await assertPublicHttpUrl(raw, lookup) : await assertPublicHttpUrl(raw);
  } catch {
    return null;
  }
}

/** fetch com timeout e sem seguir redirect (quem chama decide, passando pelo guarda). */
async function rawFetch(
  url: string,
  init: RequestInit,
  deps: ImageFallbackDeps,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return fetchImpl(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

/** fetch que segue até 3 redirects validando cada salto contra hosts privados. */
async function safeFetch(
  url: string,
  init: RequestInit,
  deps: ImageFallbackDeps,
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isPublicUrl(current, deps.lookup))) return null;
    const res = await rawFetch(current, init, deps);
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  return null;
}

/** HEAD (ou GET de 1 byte se o servidor não aceita HEAD): 2xx com content-type de imagem. */
export async function isImageAlive(url: string, deps: ImageFallbackDeps = {}): Promise<boolean> {
  try {
    let res = await safeFetch(url, { method: 'HEAD' }, deps);
    if (res && (res.status === 405 || res.status === 501)) {
      res = await safeFetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, deps);
      void res?.body?.cancel().catch(() => undefined);
    }
    if (!res || res.status < 200 || res.status >= 300) return false;
    return (res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

const isAwinHost = (host: string) => host === 'awin1.com' || host.endsWith('.awin1.com');

async function acceptMerchant(raw: string | null, base: string, deps: ImageFallbackDeps) {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return (await isPublicUrl(url.toString(), deps.lookup)) ? url.toString() : null;
}

/**
 * URL da página do produto na loja a partir do link de afiliado da Awin: `cread.php` traz o
 * destino no parâmetro `ued`; `pclick.php` (e outros) é lido do `Location` de um GET sem seguir
 * o redirect. Só aceita destino https em host público.
 */
export async function resolveMerchantUrl(
  awinLink: string,
  deps: ImageFallbackDeps = {},
): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(awinLink);
  } catch {
    return null;
  }
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      if (!isAwinHost(current.hostname.toLowerCase())) {
        return acceptMerchant(current.toString(), current.toString(), deps);
      }
      const ued = current.searchParams.get('ued');
      if (ued) return acceptMerchant(ued, current.toString(), deps);
      if (!(await isPublicUrl(current.toString(), deps.lookup))) return null;
      const res = await rawFetch(current.toString(), { method: 'GET' }, deps);
      void res.body?.cancel().catch(() => undefined);
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) return null;
      const next = await acceptMerchant(location, current.toString(), deps);
      if (!next) return null;
      current = new URL(next);
    }
  } catch {
    return null;
  }
  return null;
}

function toHttps(raw: string): string | null {
  const fixed = raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:\/\//i, 'https://');
  try {
    return new URL(fixed).protocol === 'https:' ? fixed : null;
  } catch {
    return null;
  }
}

/**
 * Primeira imagem do produto no catálogo público da VTEX (`/api/catalog_system/pub/products/
 * search/<slug>/p`). Só tenta para páginas de produto VTEX (caminho termina em `/p`); qualquer
 * outra loja ou erro devolve null.
 */
export async function resolveVtexImage(
  merchantUrl: string,
  deps: ImageFallbackDeps = {},
): Promise<string | null> {
  try {
    const url = new URL(merchantUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments[segments.length - 1] !== 'p') return null;
    const slug = decodeURIComponent(segments[segments.length - 2]!);
    if (!/^[\w.-]+$/.test(slug)) return null;
    const api = `${url.origin}/api/catalog_system/pub/products/search/${encodeURIComponent(slug)}/p`;
    const res = await safeFetch(
      api,
      { method: 'GET', headers: { Accept: 'application/json' } },
      deps,
    );
    if (!res || !res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;
    const first = data[0] as { items?: { images?: { imageUrl?: unknown }[] }[] } | undefined;
    const imageUrl = first?.items?.[0]?.images?.[0]?.imageUrl;
    return typeof imageUrl === 'string' && imageUrl ? toHttps(imageUrl) : null;
  } catch {
    return null;
  }
}

async function cacheGet(deps: ImageFallbackDeps, key: string): Promise<string | null> {
  try {
    return (await deps.cache?.get(key)) ?? null;
  } catch {
    return null;
  }
}

async function cacheSet(deps: ImageFallbackDeps, key: string, value: string, ttl: number) {
  try {
    await deps.cache?.set(key, value, ttl);
  } catch {
    // cache é otimização; falha não impede a resposta
  }
}

/** `isImageAlive` com o resultado guardado por URL (vivo 7 dias, morto 1 dia). */
export async function isImageAliveCached(url: string, deps: ImageFallbackDeps = {}) {
  const key = imageAliveCacheKey(url);
  const cached = await cacheGet(deps, key);
  if (cached === '1') return true;
  if (cached === '0') return false;
  const alive = await isImageAlive(url, deps);
  await cacheSet(
    deps,
    key,
    alive ? '1' : '0',
    alive ? IMAGE_HIT_TTL_SECONDS : IMAGE_MISS_TTL_SECONDS,
  );
  return alive;
}

/** Imagem que se sabe (pelo cache) estar fora do ar; sem cache ou sem registro → false. */
export async function isKnownDeadImage(url: string, deps: ImageFallbackDeps = {}) {
  return (await cacheGet(deps, imageAliveCacheKey(url))) === '0';
}

/**
 * Imagem a exibir para um produto Awin: a do feed se está no ar; senão a da loja (VTEX) a partir
 * do link de afiliado. Resultado vai para o cache (achou: 7 dias; não achou: 1 dia). Nunca lança.
 */
export async function resolveFallbackImage(
  input: { imageUrl: string | null; deepLink: string },
  deps: ImageFallbackDeps = {},
): Promise<FallbackImageResult> {
  const original = input.imageUrl || null;
  try {
    if (original && (await isImageAliveCached(original, deps))) {
      return { url: original, status: 'alive' };
    }
    const key = resolvedCacheKey(original, input.deepLink);
    const cached = await cacheGet(deps, key);
    if (cached === MISS) return { url: original, status: 'unresolved' };
    if (cached) return { url: cached, status: 'resolved' };

    const merchant = await resolveMerchantUrl(input.deepLink, deps);
    const candidate = merchant ? await resolveVtexImage(merchant, deps) : null;
    const found = candidate && (await isImageAlive(candidate, deps)) ? candidate : null;
    await cacheSet(
      deps,
      key,
      found ?? MISS,
      found ? IMAGE_HIT_TTL_SECONDS : IMAGE_MISS_TTL_SECONDS,
    );
    return found ? { url: found, status: 'resolved' } : { url: original, status: 'unresolved' };
  } catch {
    return { url: original, status: 'unresolved' };
  }
}

/**
 * Roda `fn` sobre os itens com no máximo `concurrency` em paralelo e espera no máximo `budgetMs`.
 * Itens que não terminaram no prazo ficam `undefined` no resultado (seguem rodando em segundo
 * plano, com erro engolido). Erros de um item também viram `undefined`.
 */
export async function runWithBudget<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: { concurrency: number; budgetMs: number },
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch {
        results[i] = undefined;
      }
    }
  };
  const all = Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency, items.length)) }, worker),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, opts.budgetMs);
  });
  await Promise.race([all, deadline]);
  clearTimeout(timer);
  return [...results];
}
