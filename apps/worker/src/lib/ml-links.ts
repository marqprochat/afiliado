import { ML_AFF_LINK_TTL_SEC, mlAffLinkKey } from '@afilados/marketplaces';
import { getRedis } from './redis';

/** Armazenamento mínimo usado pelo cache de links (Redis em produção, memória nos testes). */
export interface LinkStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function redisLinkStore(): LinkStore {
  const redis = getRedis();
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSec) => {
      if (ttlSec) await redis.set(key, value, 'EX', ttlSec);
      else await redis.set(key, value);
    },
    del: async (key) => {
      await redis.del(key);
    },
  };
}

/**
 * Consulta o cache de links meli.la (preenchido pelo pré-aquecimento) antes de gerar. Só guarda link
 * oficial: o fallback matt_word/matt_tool não deve ficar 24 h impedindo o link oficial de ser usado
 * quando a sessão voltar. Falha do Redis nunca impede o envio.
 */
export async function withMlLinkCache(
  tenantId: string,
  tag: string | undefined,
  url: string,
  generate: () => Promise<string>,
  store: LinkStore = redisLinkStore(),
): Promise<string> {
  const key = mlAffLinkKey(tenantId, tag, url);
  const hit = await store.get(key).catch(() => null);
  if (hit) return hit;
  const link = await generate();
  if (/^https:\/\/meli\.la\//.test(link)) {
    await store.set(key, link, ML_AFF_LINK_TTL_SEC).catch(() => {});
  }
  return link;
}
