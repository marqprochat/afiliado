import { createHash } from 'node:crypto';
import { assertPublicHttpUrl, type LookupAll } from '@afilados/core/safe-url';
import { DEFAULT_AWIN_PARTNERS } from './programmes';

/**
 * Imagem substituta para produtos da Awin cujo feed aponta para imagens que saíram do ar.
 *
 * Caso real: o feed da Drogal (anunciante 68224) ainda aponta para `io.convertiez.com.br`, que dá
 * 404 em tudo depois da migração da loja para a VTEX. O catálogo público da VTEX da loja devolve
 * as imagens atuais a partir do slug do produto.
 *
 * NUNCA faz requisição aos links de rastreio da Awin (awin1.com): um GET lá pode contar como
 * clique de afiliado e gerar alerta de fraude na conta. A loja sai do `ued` (cread.php) ou do id
 * do anunciante (`m`/`awinmid`) mapeado para o domínio; o slug sai do `ued`, do nome do arquivo
 * da imagem quebrada ou, por último, de uma busca pelo título na VTEX.
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
  /** id do anunciante Awin → origem da loja; omitido = `DEFAULT_AWIN_PARTNERS`. */
  merchantOrigins?: Record<string, string>;
}

export type FallbackImageStatus = 'alive' | 'resolved' | 'unresolved';

export interface FallbackImageResult {
  /** Imagem a exibir: a original se está no ar, a substituta se achou, senão a original mesmo. */
  url: string | null;
  status: FallbackImageStatus;
}

export interface FallbackImageInput {
  imageUrl: string | null;
  deepLink: string;
  /** Título do produto, para a busca por texto na VTEX quando não há slug. */
  title?: string | null;
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

/** Hosts de rastreio da Awin: nunca recebem requisição deste módulo. */
export const isAwinTrackingHost = (host: string) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'awin1.com' || h.endsWith('.awin1.com');
};

async function isPublicUrl(raw: string, lookup?: LookupAll): Promise<URL | null> {
  try {
    const url = lookup ? await assertPublicHttpUrl(raw, lookup) : await assertPublicHttpUrl(raw);
    return isAwinTrackingHost(url.hostname) ? null : url;
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

/**
 * fetch que segue até 3 redirects validando cada salto contra hosts privados e contra os hosts
 * de rastreio da Awin.
 */
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

/** id do anunciante → origem da loja a partir de `DEFAULT_AWIN_PARTNERS`. */
export function defaultMerchantOrigins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Object.values(DEFAULT_AWIN_PARTNERS)) {
    try {
      out[p.advertiserId] = new URL(p.displayUrl || `https://www.${p.domain}`).origin;
    } catch {
      out[p.advertiserId] = `https://www.${p.domain}`;
    }
  }
  return out;
}

export interface MerchantTarget {
  /** Origem https da loja. */
  origin: string;
  /** URL da página do produto na loja, quando o link a traz (`ued`). */
  productUrl: string | null;
}

function httpsUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !isAwinTrackingHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Loja (e, se der, a página do produto) a partir do link de afiliado, SEM requisição: `cread.php`
 * traz o destino em `ued`; `pclick.php` (ou cread sem `ued`) traz o anunciante em `m`/`awinmid`,
 * mapeado para a origem da loja. Link que não é da Awin já é a página da loja. Só aceita https
 * em host público.
 */
export async function resolveMerchantUrl(
  link: string,
  deps: ImageFallbackDeps = {},
): Promise<MerchantTarget | null> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  let target: MerchantTarget | null = null;
  if (!isAwinTrackingHost(url.hostname)) {
    const direct = httpsUrl(link);
    target = direct ? { origin: direct.origin, productUrl: direct.toString() } : null;
  } else {
    const ued = httpsUrl(url.searchParams.get('ued'));
    if (ued) {
      target = { origin: ued.origin, productUrl: ued.toString() };
    } else {
      const advertiserId = url.searchParams.get('m') ?? url.searchParams.get('awinmid');
      const origins = deps.merchantOrigins ?? defaultMerchantOrigins();
      const origin = advertiserId ? httpsUrl(origins[advertiserId]) : null;
      target = origin ? { origin: origin.origin, productUrl: null } : null;
    }
  }
  if (!target) return null;
  return (await isPublicUrl(target.origin, deps.lookup)) ? target : null;
}

function toHttps(raw: string): string | null {
  const fixed = raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:\/\//i, 'https://');
  try {
    return new URL(fixed).protocol === 'https:' ? fixed : null;
  } catch {
    return null;
  }
}

const SLUG_RE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i;

/** Slug de página de produto VTEX (`…/<slug>/p`) ou null. */
export function slugFromProductUrl(productUrl: string | null | undefined): string | null {
  if (!productUrl) return null;
  try {
    const segments = new URL(productUrl).pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments[segments.length - 1] !== 'p') return null;
    const slug = decodeURIComponent(segments[segments.length - 2]!);
    return SLUG_RE.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/**
 * Slug a partir do nome do arquivo da imagem do feed:
 * `…/large/fraldas-pampers-…-36-unidades_31925.jpg` → `fraldas-pampers-…-36-unidades`.
 * Exige ao menos um hífen (nome de arquivo numérico ou hash não é slug).
 */
export function slugFromImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  try {
    const file = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '');
    const slug = file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_\d+$/, '');
    return slug.includes('-') && /^[a-z0-9-]+$/i.test(slug) ? slug.toLowerCase() : null;
  } catch {
    return null;
  }
}

type VtexProduct = { productName?: unknown; items?: { images?: { imageUrl?: unknown }[] }[] };

async function vtexSearch(api: string, deps: ImageFallbackDeps): Promise<VtexProduct[] | null> {
  const res = await safeFetch(
    api,
    { method: 'GET', headers: { Accept: 'application/json' } },
    deps,
  );
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as unknown;
  return Array.isArray(data) ? (data as VtexProduct[]) : null;
}

function firstImage(p: VtexProduct | undefined): string | null {
  const imageUrl = p?.items?.[0]?.images?.[0]?.imageUrl;
  return typeof imageUrl === 'string' && imageUrl ? toHttps(imageUrl) : null;
}

/** Primeira imagem do produto no catálogo público da VTEX pelo slug; erro/loja não VTEX → null. */
export async function resolveVtexImageBySlug(
  origin: string,
  slug: string,
  deps: ImageFallbackDeps = {},
): Promise<string | null> {
  return (await resolveVtexProductBySlug(origin, slug, deps))?.imageUrl ?? null;
}

/** Nome e primeira imagem do produto VTEX pelo slug; erro/loja não VTEX/sem imagem → null. */
export async function resolveVtexProductBySlug(
  origin: string,
  slug: string,
  deps: ImageFallbackDeps = {},
): Promise<{ imageUrl: string; productName: string | null } | null> {
  try {
    if (!SLUG_RE.test(slug)) return null;
    const base = new URL(origin).origin;
    const api = `${base}/api/catalog_system/pub/products/search/${encodeURIComponent(slug)}/p`;
    const first = (await vtexSearch(api, deps))?.[0];
    const imageUrl = firstImage(first);
    if (!imageUrl) return null;
    return {
      imageUrl,
      productName: typeof first?.productName === 'string' ? first.productName : null,
    };
  } catch {
    return null;
  }
}

/** Primeira imagem a partir da página de produto VTEX (`…/<slug>/p`); outra URL → null. */
export async function resolveVtexImage(
  merchantUrl: string,
  deps: ImageFallbackDeps = {},
): Promise<string | null> {
  const slug = slugFromProductUrl(merchantUrl);
  if (!slug) return null;
  try {
    return await resolveVtexImageBySlug(new URL(merchantUrl).origin, slug, deps);
  } catch {
    return null;
  }
}

const tokens = (s: string) =>
  new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // `+` faz parte do termo: "RN" e "RN+" são produtos diferentes na loja.
      .split(/[^a-z0-9+]+/)
      .filter((t) => /[a-z0-9]/.test(t)),
  );

/** Mesmo produto pelo nome: mesmos termos (ordem/acentos/pontuação ignorados) ou ≥ 90% em comum. */
export function titlesMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / (ta.size + tb.size - common) >= 0.9;
}

/** Busca por texto na VTEX; só aceita o primeiro resultado se o nome bater com o título. */
export async function resolveVtexImageByTitle(
  origin: string,
  title: string,
  deps: ImageFallbackDeps = {},
): Promise<string | null> {
  try {
    const q = title.trim();
    if (!q) return null;
    const base = new URL(origin).origin;
    const api = `${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=0`;
    const first = (await vtexSearch(api, deps))?.[0];
    if (typeof first?.productName !== 'string' || !titlesMatch(first.productName, q)) return null;
    return firstImage(first);
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
 * Imagem a exibir para um produto Awin: a do feed se está no ar; senão a da loja (VTEX), sem
 * nunca requisitar o link de rastreio da Awin. Resultado vai para o cache (achou: 7 dias; não
 * achou: 1 dia). Nunca lança.
 */
export async function resolveFallbackImage(
  input: FallbackImageInput,
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

    const found = await findReplacement(input, deps);
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
 * Slug do `ued` -> slug do nome da imagem -> busca pelo título; só vale imagem que está no ar.
 * Com título, o produto achado pelo slug precisa ter o mesmo nome; se não tiver, a busca pelo
 * título tem preferência e o achado pelo slug fica de reserva (imagem quase igual > nenhuma).
 */
async function findReplacement(
  input: FallbackImageInput,
  deps: ImageFallbackDeps,
): Promise<string | null> {
  const target = await resolveMerchantUrl(input.deepLink, deps);
  if (!target) return null;
  const title = input.title?.trim() || null;
  const slugs = [
    ...new Set(
      [slugFromProductUrl(target.productUrl), slugFromImageUrl(input.imageUrl)].filter(
        (s): s is string => Boolean(s),
      ),
    ),
  ];
  let reserve: string | null = null;
  for (const slug of slugs) {
    const product = await resolveVtexProductBySlug(target.origin, slug, deps);
    if (!product || !(await isImageAlive(product.imageUrl, deps))) continue;
    if (!title || (product.productName && titlesMatch(title, product.productName))) {
      return product.imageUrl;
    }
    reserve ??= product.imageUrl;
  }
  if (title) {
    const candidate = await resolveVtexImageByTitle(target.origin, title, deps);
    if (candidate && (await isImageAlive(candidate, deps))) return candidate;
  }
  return reserve;
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
