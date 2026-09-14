'use client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiClientError } from './api';

export function useApiMutation<TIn, TOut = unknown>(
  fn: (input: TIn) => Promise<TOut>,
  opts: {
    invalidate?: QueryKey[];
    success?: string;
    onSuccess?: (out: TOut, input: TIn) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, input) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(out, input);
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : 'Erro inesperado');
    },
  });
}
