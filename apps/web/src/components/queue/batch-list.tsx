'use client';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatDateTime } from '@/lib/format';
import type { BatchSummary } from '@/lib/types';

const LABEL: Record<string, string> = {
  SCHEDULED: 'Agendado',
  RUNNING: 'Enviando',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
  CANCELLED: 'Cancelado',
};

export function BatchList({
  batches,
  onPause,
  onResume,
  onCancel,
}: {
  batches: BatchSummary[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (!batches.length)
    return <p className="text-sm text-muted-foreground">Nenhum lote criado ainda.</p>;
  return (
    <ul className="space-y-2">
      {batches.map((b) => {
        const pct = b.total ? Math.round((b.sent / b.total) * 100) : 0;
        const active = b.status === 'SCHEDULED' || b.status === 'RUNNING';
        return (
          <li key={b.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
            <div className="flex items-center gap-2">
              <b>{b.name}</b>
              <StatusPill label={LABEL[b.status] ?? b.status} status={b.status} />
              <span className="ml-auto text-xs text-muted-foreground">
                {b.sent}/{b.total} · {b.errors > 0 ? `${b.errors} erro(s) · ` : ''}término{' '}
                {formatDateTime(b.estimatedEndAt)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
              <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex gap-2">
              {active && (
                <Button size="sm" variant="secondary" onClick={() => onPause(b.id)}>
                  Pausar
                </Button>
              )}
              {b.status === 'PAUSED' && (
                <Button
                  size="sm"
                  className="bg-brand text-white hover:bg-brand/90"
                  onClick={() => onResume(b.id)}
                >
                  Retomar
                </Button>
              )}
              {(active || b.status === 'PAUSED') && (
                <Button size="sm" variant="destructive" onClick={() => onCancel(b.id)}>
                  Cancelar
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
