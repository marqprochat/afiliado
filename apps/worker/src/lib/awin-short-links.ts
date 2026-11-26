import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  AWIN_LEGACY_API_INTERVAL_MS,
  generateAwinLink,
  getAwinLinkQuota,
  parseAwinCreadLink,
  type AwinLinkCreds,
  type AwinLinkQuota,
} from '@afilados/marketplaces';
import { getRedis } from './redis';

const log = pino({ name: 'awin-short-links' });

/** Setting (tabela Setting) que liga os links curtos da Awin no envio. */
export const AWIN_SHORT_LINKS_KEY = 'awinShortLinks';
/** Mesma chave de cache da API (`apps/api/src/lib/awin-links.ts`). */
export const awinQuotaCacheKey = (tenantId: string) => `awin:link-quota:${tenantId}`;
/** Vaga da API legada da Awin por tenant (1 chamada a cada 3,1 s). */
export const awinLegacyApiSlotKey = (tenantId: string) => `awin:legacy-api:slot:${tenantId}`;
const QUOTA_TTL_SECONDS = 600;
const MAX_SLOT_WAITS = 30;

/** Armazenamento do cache da cota e da vaga do limitador (Redis em produção). */
export interface ShortenerStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Regrava mantendo o TTL atual. */
  replace(key: string, value: string): Promise<void>;
  /** Reserva a vaga por `ms`: 0 se reservou; senão, quantos ms faltam para liberar. */
  reserve(key: string, ms: number, nowMs: number): Promise<number>;
}

export function redisShortenerStore(redis: Redis): ShortenerStore {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value, 'EX', ttl);
    },
    replace: async (key, value) => {
      await redis.set(key, value, 'KEEPTTL');
    },
    reserve: async (key, ms) => {
      const ok = await redis.set(key, '1', 'PX', ms, 'NX');
      if (ok) return 0;
      const left = await redis.pttl(key);
      return left > 0 ? left : 50;
    },
  };
}

/** Armazenamento em memória (testes). */
export function memoryShortenerStore(): ShortenerStore {
  const values = new Map<string, string>();
  const slots = new Map<string, number>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    replace: async (key, value) => {
      values.set(key, value);
    },
    reserve: async (key, ms, nowMs) => {
      const until = slots.get(key) ?? 0;
      if (until > nowMs) return until - nowMs;
      slots.set(key, nowMs + ms);
      return 0;
    },
  };
}

export interface AwinShortenerDeps {
  store?: ShortenerStore;
  getQuota?: (creds: AwinLinkCreds) => Promise<AwinLinkQuota>;
  generate?: typeof generateAwinLink;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AwinShortenerInput {
  tenantId: string;
  settings: Record<string, unknown>;
  creds: { publisherId?: string | undefined; offersApiToken?: string | undefined } | null;
  /** Quantos canais vão receber o item (a cota precisa cobrir todos). */
  channels: number;
}

export interface AwinShortener {
  /** Link curto (tidd.ly) para um `cread.php` direto; qualquer outro caso devolve o link igual. */
  shorten(link: string): Promise<string>;
}

const IDENTITY: AwinShortener = { shorten: async (link) => link };

/**
 * Links curtos da Awin no envio (setting `awinShortLinks`, desligado por padrão). Consulta a cota
 * uma vez (cache de 10 min por tenant) e só encurta se ela cobre todos os canais do item; cada link
 * curto respeita 1 chamada a cada 3,1 s por tenant. Qualquer falha mantém o link longo. Nunca
 * requisita o link de rastreio: o `cread.php` é só lido (`parseAwinCreadLink`).
 */
export function createAwinShortener(
  input: AwinShortenerInput,
  deps: AwinShortenerDeps = {},
): AwinShortener {
  const publisherId = input.creds?.publisherId?.trim();
  const token = input.creds?.offersApiToken?.trim();
  if (input.settings[AWIN_SHORT_LINKS_KEY] !== true || !publisherId || !token) return IDENTITY;
  const creds: AwinLinkCreds = { publisherId, offersApiToken: token };
  const store = deps.store ?? redisShortenerStore(getRedis());
  const getQuota = deps.getQuota ?? ((c: AwinLinkCreds) => getAwinLinkQuota(c));
  const generate = deps.generate ?? generateAwinLink;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const quotaKey = awinQuotaCacheKey(input.tenantId);
  const channels = Math.max(1, input.channels);

  let approval: Promise<boolean> | null = null;
  const approve = async (): Promise<boolean> => {
    let quota: AwinLinkQuota | null = null;
    const cached = await store.get(quotaKey);
    if (cached) {
      try {
        quota = JSON.parse(cached) as AwinLinkQuota;
      } catch {
        quota = null;
      }
    }
    if (!quota) {
      quota = await getQuota(creds);
      await store.set(quotaKey, JSON.stringify(quota), QUOTA_TTL_SECONDS);
    }
    return quota.remaining !== null && quota.remaining >= channels;
  };

  const waitSlot = async (): Promise<boolean> => {
    const key = awinLegacyApiSlotKey(input.tenantId);
    for (let i = 0; i < MAX_SLOT_WAITS; i++) {
      const wait = await store.reserve(key, AWIN_LEGACY_API_INTERVAL_MS, now());
      if (wait <= 0) return true;
      await sleep(wait);
    }
    return false;
  };

  const consume = async () => {
    const cached = await store.get(quotaKey);
    if (!cached) return;
    const q = JSON.parse(cached) as AwinLinkQuota;
    await store.replace(
      quotaKey,
      JSON.stringify({
        limit: q.limit,
        usage: q.usage + 1,
        remaining: q.remaining === null ? null : Math.max(0, q.remaining - 1),
      }),
    );
  };

  return {
    async shorten(link) {
      const request = parseAwinCreadLink(link);
      if (!request) return link;
      try {
        approval ??= approve();
        if (!(await approval)) return link;
        if (!(await waitSlot())) return link;
        const { shortUrl } = await generate(creds, request, { shorten: true });
        if (!shortUrl) return link;
        await consume().catch(() => undefined);
        return shortUrl;
      } catch (err) {
        log.warn(
          { tenantId: input.tenantId, err: err instanceof Error ? err.message : String(err) },
          'falha ao gerar link curto da Awin; enviando o link longo',
        );
        return link;
      }
    },
  };
}
