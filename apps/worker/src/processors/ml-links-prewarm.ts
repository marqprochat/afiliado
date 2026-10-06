import type { Job } from 'bullmq';
import pino from 'pino';
import type { MlLinksPrewarmJob, TagCredentials } from '@afilados/shared';
import {
  ML_AFF_LINK_TTL_SEC,
  generateOfficialMlLink,
  generateOfficialMlLinks,
  mlAffLinkKey,
  mlLinksErrorKey,
  prewarmMlAffiliateLinks,
  type BatchLinkResult,
  type PrewarmResult,
} from '@afilados/marketplaces';
import { loadTagCredentials } from '../lib/marketplace-credentials';
import { normalizeMlTag, redisLinkStore, type LinkStore } from '../lib/ml-links';

const log = pino({ name: 'ml-links-prewarm' });

export interface MlLinksPrewarmDeps {
  loadCredentials?: (tenantId: string) => Promise<TagCredentials>;
  store?: LinkStore;
  generateBatch?: (urls: string[]) => Promise<BatchLinkResult>;
  generateSingle?: (url: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/**
 * Gera antecipadamente os links meli.la das URLs pedidas (lote de 20 → individual como fallback) e
 * os guarda no Redis para o envio. Sem sessão do ML sincronizada não há o que fazer (e não é erro).
 */
export async function runMlLinksPrewarm(
  deps: MlLinksPrewarmDeps,
  { tenantId, urls }: MlLinksPrewarmJob,
): Promise<PrewarmResult | { skipped: 'sem-sessao' | 'em-cache' }> {
  const creds = await (deps.loadCredentials ?? ((id) => loadTagCredentials(id, 'MERCADOLIVRE')))(
    tenantId,
  );
  const cookies = creds.mlSession?.cookies;
  if (!cookies || Object.keys(cookies).length === 0) {
    log.info({ tenantId }, 'sem sessão do ML sincronizada; pré-aquecimento ignorado');
    return { skipped: 'sem-sessao' };
  }
  const tag = normalizeMlTag(creds.tag);
  const store = deps.store ?? redisLinkStore();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const pending: string[] = [];
  for (const url of new Set(urls)) {
    if (!(await store.get(mlAffLinkKey(tenantId, tag, url)).catch(() => null))) pending.push(url);
  }
  if (pending.length === 0) return { skipped: 'em-cache' };

  const result = await prewarmMlAffiliateLinks(pending, {
    generateBatch:
      deps.generateBatch ??
      ((batchUrls) => generateOfficialMlLinks(batchUrls, cookies, { tag, pauseMs: 2500 })),
    generateSingle:
      deps.generateSingle ?? ((url) => generateOfficialMlLink(url, cookies, tag ? { tag } : {})),
    store: (url, link) => store.set(mlAffLinkKey(tenantId, tag, url), link, ML_AFF_LINK_TTL_SEC),
    recordError: async (error) => {
      await store.set(mlLinksErrorKey(tenantId), JSON.stringify(error));
      log.warn({ tenantId, ...error }, 'gerador de links em lote falhou');
    },
    clearError: () => store.del(mlLinksErrorKey(tenantId)),
    sleep,
    ...(deps.now ? { now: deps.now } : {}),
  });
  log.info({ tenantId, ...result }, 'pré-aquecimento de links do ML concluído');
  return result;
}

export function createMlLinksPrewarmProcessor(deps: MlLinksPrewarmDeps = {}) {
  return async (job: Job<MlLinksPrewarmJob>) => runMlLinksPrewarm(deps, job.data);
}
