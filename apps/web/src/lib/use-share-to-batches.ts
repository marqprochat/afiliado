'use client';
import { toast } from 'sonner';
import { apiFetch } from './api';
import { summarizeShare } from './batch-target';
import { useApiMutation } from './mutations';
import type { BatchPosition, BatchShareResponse, BatchSummary } from './types';

const INV = [['queue'], ['batches'], ['overview']];

export interface ShareToBatchesInput {
  productIds: string[];
  batchIds: string[];
  position: BatchPosition;
}

/**
 * Copia produtos para um ou mais lotes (POST /batches/share) e mostra o resumo em toasts.
 * `onShared` roda quando ao menos um lote recebeu os produtos.
 */
export function useShareToBatches(batches: BatchSummary[], onShared: () => void) {
  return useApiMutation(
    (body: ShareToBatchesInput) =>
      apiFetch<BatchShareResponse>('/batches/share', { method: 'POST', json: body }),
    {
      invalidate: INV,
      onSuccess: (out) => {
        const s = summarizeShare(out.results, batches);
        if (s.okCount > 0) {
          const skipped = s.skipped > 0 ? ` (${s.skipped} ignorado(s))` : '';
          toast.success(`${s.added} adicionado(s) em ${s.okCount} lote(s)${skipped}`);
          onShared();
        }
        for (const f of s.failed) toast.error(`«${f.name}»: ${f.message}`);
      },
    },
  );
}
