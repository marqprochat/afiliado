import type { BatchShareResult, BatchSummary, EligibleBatch } from './types';

/**
 * Filtra e prepara lotes elegíveis para receber produtos da triagem:
 * - Exclui lotes cancelados (CANCELLED)
 * - Calcula a quantidade pendente de envios (total - sent - errors)
 * - Ordena lotes ativos (SCHEDULED, RUNNING, PAUSED) antes de lotes concluídos (DONE)
 */
export function eligibleBatches(batches: BatchSummary[]): EligibleBatch[] {
  return batches
    .filter((b) => b.status !== 'CANCELLED')
    .map((b) => ({
      ...b,
      pending: Math.max(0, b.total - b.sent - b.errors),
    }))
    .sort((a, b) => {
      const aDone = a.status === 'DONE' ? 1 : 0;
      const bDone = b.status === 'DONE' ? 1 : 0;
      return aDone - bDone;
    });
}

/** Resume o retorno de POST /batches/share para montar os toasts. */
export function summarizeShare(
  results: BatchShareResult[],
  batches: Array<{ id: string; name: string }>,
) {
  const nameOf = (id: string) => batches.find((b) => b.id === id)?.name ?? id;
  let added = 0;
  let skipped = 0;
  let okCount = 0;
  const failed: Array<{ name: string; message: string }> = [];
  for (const r of results) {
    if (r.ok) {
      okCount++;
      added += r.added;
      skipped += r.skipped;
    } else {
      failed.push({ name: nameOf(r.batchId), message: r.error?.message ?? 'Erro inesperado' });
    }
  }
  return { added, skipped, okCount, failed };
}
