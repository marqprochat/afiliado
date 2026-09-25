'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusPill } from '@/components/app-shell/status-pill';
import { BATCH_STATUS_LABEL } from '@/components/queue/batch-manage-drawer';
import { formatDateTime } from '@/lib/format';
import type { BatchSummary } from '@/lib/types';

export function BatchList({
  batches,
  onPause,
  onResume,
  onCancel,
  onManage,
  onDelete,
}: {
  batches: BatchSummary[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onManage: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [toDelete, setToDelete] = useState<BatchSummary | null>(null);
  if (!batches.length)
    return <p className="text-sm text-muted-foreground">Nenhum lote criado ainda.</p>;
  return (
    <>
      <ul className="space-y-2">
        {batches.map((b) => {
          const pct = b.total ? Math.round((b.sent / b.total) * 100) : 0;
          const active = b.status === 'SCHEDULED' || b.status === 'RUNNING';
          return (
            <li key={b.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
              <div className="flex items-center gap-2">
                <b>{b.name}</b>
                <StatusPill label={BATCH_STATUS_LABEL[b.status] ?? b.status} status={b.status} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {b.sent}/{b.total} · {b.errors > 0 ? `${b.errors} erro(s) · ` : ''}término{' '}
                  {formatDateTime(b.estimatedEndAt)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
                <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onManage(b.id)}>
                  Gerenciar
                </Button>
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
                {!active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setToDelete(b)}
                  >
                    Excluir
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lote “{toDelete?.name}”?</DialogTitle>
            <DialogDescription>
              O lote e toda a fila dele são removidos, e os envios pendentes não acontecem mais. O
              histórico do que já foi enviado continua nos relatórios. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (toDelete) onDelete(toDelete.id);
                setToDelete(null);
              }}
            >
              Excluir lote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
