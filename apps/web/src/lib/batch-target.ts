import type { BatchSummary, EligibleBatch } from './types';

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
