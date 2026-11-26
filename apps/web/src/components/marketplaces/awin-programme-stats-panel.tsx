'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AwinProgrammeStatsItem } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { formatEpc } from '@/lib/awin-ranking';
import { formatDateTime } from '@/lib/format';
import { useAwinProgrammeStats } from '@/lib/queries';

/** Enquanto a atualização roda, confere a cada 15 s por até 15 min (a Awin limita 20 consultas/min). */
const POLL_MS = 15_000;
const POLL_MAX_MS = 15 * 60_000;

const pct = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

function commission(i: AwinProgrammeStatsItem): string {
  if (i.commissionMin === null && i.commissionMax === null) return '—';
  const isPct = !i.commissionType || /percent/i.test(i.commissionType);
  const fmt = (v: number) => (isPct ? pct(v) : formatEpc(v, i.currency));
  const min = i.commissionMin ?? i.commissionMax!;
  const max = i.commissionMax ?? i.commissionMin!;
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

/** Score maior primeiro; sem score no fim (a API já devolve nessa ordem, com os desempates). */
function byScore(a: AwinProgrammeStatsItem, b: AwinProgrammeStatsItem) {
  if (a.score === b.score) return 0;
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
}

export function AwinProgrammeStatsPanel({ canRefresh = true }: { canRefresh?: boolean }) {
  const [refreshing, setRefreshing] = useState<{ since: string | null; at: number } | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const { data, isLoading, isError, error } = useAwinProgrammeStats(refreshing ? POLL_MS : false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const items = useMemo(() => [...(data?.items ?? [])].sort(byScore), [data?.items]);

  useEffect(() => {
    if (!refreshing || !data) return;
    if (data.fetchedAt && data.fetchedAt !== refreshing.since) {
      setRefreshing(null);
      setFeedback({ message: 'Indicadores atualizados.', ok: true });
    } else if (Date.now() - refreshing.at > POLL_MAX_MS) {
      setRefreshing(null);
    }
  }, [data, refreshing]);

  async function handleRefresh() {
    setSending(true);
    setFeedback(null);
    try {
      await apiFetch('/marketplaces/awin/programme-stats/refresh', { method: 'POST' });
      if (!mounted.current) return;
      setRefreshing({ since: data?.fetchedAt ?? null, at: Date.now() });
      setFeedback({
        message:
          'Atualização na fila. Os indicadores aparecem em alguns minutos (a Awin permite 20 consultas por minuto).',
        ok: true,
      });
    } catch (err) {
      if (!mounted.current) return;
      setFeedback({
        message: err instanceof Error ? err.message : 'Não foi possível atualizar os indicadores.',
        ok: false,
      });
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Indicadores dos programas</p>
        {canRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sending || !!refreshing}
            onClick={() => void handleRefresh()}
          >
            {sending ? 'Enviando...' : refreshing ? 'Atualizando...' : 'Atualizar indicadores'}
          </Button>
        )}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Ordenados pelo score (EPC × taxa de aprovação). Lojas com score maior tendem a converter e
        pagar melhor.
      </p>

      {isLoading && <p className="text-xs text-muted-foreground">Carregando indicadores...</p>}
      {isError && (
        <p role="alert" className="break-words text-xs text-red-400">
          Não foi possível carregar os indicadores:{' '}
          {error instanceof Error ? error.message : 'erro sem detalhe'}
        </p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum indicador ainda. Clique em &quot;Atualizar indicadores&quot; (requer o Publisher ID
          e o token de API da Awin); a atualização automática roda uma vez por dia.
        </p>
      )}
      {items.length > 0 && (
        <>
          <div className="max-h-80 overflow-auto rounded border border-border">
            <table aria-label="Indicadores dos programas" className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-surface-2 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Loja</th>
                  <th className="px-2 py-1.5 text-right font-medium">EPC</th>
                  <th className="px-2 py-1.5 text-right font-medium">Conversão</th>
                  <th className="px-2 py-1.5 text-right font-medium">Aprovação</th>
                  <th className="px-2 py-1.5 text-right font-medium">Pagamento</th>
                  <th className="px-2 py-1.5 text-right font-medium">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.advertiserId} className="border-t border-border">
                    <td className="max-w-[160px] truncate px-2 py-1.5" title={i.name}>
                      {i.name}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {formatEpc(i.epc, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {pct(i.conversionRate)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {pct(i.approvalPercentage)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {i.averagePaymentTime === null ? '—' : `${i.averagePaymentTime} dias`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{commission(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data?.fetchedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Atualizado em {formatDateTime(data.fetchedAt)}
            </p>
          )}
        </>
      )}
      {feedback && (
        <p
          role={feedback.ok ? 'status' : 'alert'}
          className={`mt-2 break-words text-xs ${feedback.ok ? 'text-emerald-500' : 'text-red-400'}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
