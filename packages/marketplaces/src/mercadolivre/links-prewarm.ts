import { createHash } from 'node:crypto';
import { MlSessionError, type BatchLinkResult } from './official-link';

/** Links meli.la gerados ficam 24 h no Redis (compartilhado entre API e worker). */
export const ML_AFF_LINK_TTL_SEC = 24 * 60 * 60;

export function mlAffLinkKey(tenantId: string, tag: string | undefined, url: string): string {
  const scope = tag?.trim() || 'default';
  return `ml-aff-link:${tenantId}:${scope}:${createHash('sha1').update(url).digest('hex')}`;
}

/** Último erro do gerador em lote (método 1), lido pela tela de Marketplaces. */
export function mlLinksErrorKey(tenantId: string): string {
  return `ml-links-batch:last-error:${tenantId}`;
}

export interface MlLinkBatchError {
  /** ISO 8601. */
  at: string;
  message: string;
  /** Quantas URLs o método 1 não resolveu. */
  urls: number;
  /** Quantas dessas foram salvas pelo método individual (método 2). */
  recoveredByFallback: number;
}

export interface PrewarmDeps {
  /** Método 1: gera em lote (padrão: `generateOfficialMlLinks`). */
  generateBatch: (urls: string[]) => Promise<BatchLinkResult>;
  /** Método 2: uma URL por vez (padrão: `generateOfficialMlLink`). */
  generateSingle: (url: string) => Promise<string>;
  store: (url: string, link: string) => Promise<void>;
  recordError: (error: MlLinkBatchError) => Promise<void>;
  clearError: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Pausa entre chamadas do método individual (padrão 1 s). */
  fallbackPauseMs?: number;
}

export interface PrewarmResult {
  viaBatch: number;
  viaFallback: number;
  failed: number;
  sessionExpired: boolean;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Gera e guarda os links de afiliado antes do envio. Tenta o método 1 (lote); o que ele não resolver
 * cai no método 2 (individual). Sessão expirada interrompe tudo, porque o método 2 falharia igual.
 * O resultado do método 1 fica registrado: erro (com quantos o método 2 salvou) ou limpeza do erro.
 */
export async function prewarmMlAffiliateLinks(
  urls: string[],
  deps: PrewarmDeps,
): Promise<PrewarmResult> {
  const now = deps.now ?? (() => new Date());
  const pauseMs = deps.fallbackPauseMs ?? 1000;
  const unique = [...new Set(urls)];
  const result: PrewarmResult = { viaBatch: 0, viaFallback: 0, failed: 0, sessionExpired: false };
  if (unique.length === 0) return result;

  let batch: BatchLinkResult;
  try {
    batch = await deps.generateBatch(unique);
  } catch (err) {
    if (err instanceof MlSessionError && err.code === 'ML_SESSION_EXPIRED') {
      result.failed = unique.length;
      result.sessionExpired = true;
      await deps.recordError({
        at: now().toISOString(),
        message: err.message,
        urls: unique.length,
        recoveredByFallback: 0,
      });
      return result;
    }
    batch = { links: new Map(), failures: [{ urls: unique, message: errMessage(err) }] };
  }

  for (const [url, link] of batch.links) {
    await deps.store(url, link);
    result.viaBatch++;
  }

  const missing = unique.filter((u) => !batch.links.has(u));
  for (const [i, url] of missing.entries()) {
    if (result.sessionExpired) {
      result.failed++;
      continue;
    }
    if (i > 0) await deps.sleep(pauseMs);
    try {
      await deps.store(url, await deps.generateSingle(url));
      result.viaFallback++;
    } catch (err) {
      result.failed++;
      if (err instanceof MlSessionError && err.code === 'ML_SESSION_EXPIRED') {
        result.sessionExpired = true;
      }
    }
  }

  if (missing.length > 0) {
    await deps.recordError({
      at: now().toISOString(),
      message:
        batch.failures[0]?.message ?? 'O gerador em lote não devolveu o link de algumas URLs',
      urls: missing.length,
      recoveredByFallback: result.viaFallback,
    });
  } else {
    await deps.clearError();
  }
  return result;
}
