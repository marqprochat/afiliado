'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DispatchMode, DispatchResult } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { apiFetch } from '@/lib/api';
import { useDispatchTarget } from '@/lib/dispatch-target';
import { useApiMutation } from '@/lib/mutations';
import type { ApiCoupon } from '@/lib/types';

/** Cupom que pode ser enviado: não inválido, não expirado e dentro da validade. */
export function isSelectableCoupon(c: ApiCoupon): boolean {
  if (c.status === 'INVALID' || c.status === 'EXPIRED') return false;
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return false;
  return true;
}

const SKIP_LABEL: Record<string, string> = {
  expired: 'expirado',
  invalid: 'inválido',
  'empty-code': 'sem código',
  'not-found': 'não encontrado',
};

export function CouponDispatchBar({
  couponIds,
  onClear,
}: {
  couponIds: string[];
  onClear: () => void;
}) {
  const { target, update } = useDispatchTarget('cupons');
  const [lastSkipped, setLastSkipped] = useState<DispatchResult['skipped']>([]);

  const dispatch = useApiMutation(
    (mode: DispatchMode) =>
      apiFetch<DispatchResult>('/coupons/dispatch', {
        method: 'POST',
        json: {
          couponIds,
          templateId: target.templateId,
          sessionId: target.sessionId,
          groupJids: target.groupJids,
          telegramChatIds: target.telegramChatIds,
          mode,
          intervalMin: target.intervalMin,
        },
      }),
    {
      invalidate: [['batches'], ['overview']],
      onSuccess: (res) => {
        setLastSkipped(res.skipped);
        const when =
          res.mode === 'now'
            ? 'enviando agora'
            : `primeiro envio às ${new Date(res.firstRunAt).toLocaleString('pt-BR')}`;
        toast.success(`${res.itemCount} cupom(ns) no lote "${res.name}" — ${when}`);
        onClear();
      },
    },
  );

  const canSend =
    couponIds.length > 0 && !!target.templateId && !!target.sessionId && target.groupJids.length > 0;

  return (
    <div className="sticky bottom-2 z-10 space-y-4 rounded-xl border border-brand/40 bg-card p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {couponIds.length} {couponIds.length === 1 ? 'cupom selecionado' : 'cupons selecionados'}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Limpar seleção
        </Button>
      </div>
      <DispatchTargetPicker value={target} onChange={update} templateKind="COUPON" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="bg-brand text-white hover:bg-brand/90"
          disabled={!canSend || dispatch.isPending}
          onClick={() => dispatch.mutate('now')}
        >
          Enviar agora
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSend || dispatch.isPending}
          onClick={() => dispatch.mutate('queue')}
        >
          Colocar na fila
        </Button>
      </div>
      {lastSkipped.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Ignorados no último envio:{' '}
          {lastSkipped
            .map((s) => `${s.code ?? s.id} (${SKIP_LABEL[s.reason] ?? s.reason})`)
            .join(', ')}
        </p>
      )}
    </div>
  );
}
