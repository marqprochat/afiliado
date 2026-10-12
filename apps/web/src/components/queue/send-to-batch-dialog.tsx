'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { eligibleBatches } from '@/lib/batch-target';
import type { BatchPosition, BatchSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const BATCH_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Agendado',
  RUNNING: 'Enviando',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
  CANCELLED: 'Cancelado',
};

const POSITIONS: Array<{ value: BatchPosition; label: string; title: string; hint: string }> = [
  {
    value: 'end',
    label: 'Fim da fila',
    title: 'Fim da fila (padrão)',
    hint: 'Os produtos entram após todos os envios pendentes existentes.',
  },
  {
    value: 'start',
    label: 'Começo da fila',
    title: 'Começo da fila',
    hint: 'Os produtos entram como os próximos a serem enviados pelo lote.',
  },
  {
    value: 'shuffle',
    label: 'Embaralhar',
    title: 'Embaralhar',
    hint: 'Os novos produtos entram em posições aleatórias entre os pendentes.',
  },
];

export interface SendToBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: BatchSummary[];
  count: number;
  /** Lotes que não devem aparecer como destino (ex.: o lote de origem). */
  excludeBatchIds?: string[];
  onConfirm: (params: { batchIds: string[]; position: BatchPosition }) => void | Promise<void>;
  submitting?: boolean;
}

export function SendToBatchDialog({
  open,
  onOpenChange,
  batches,
  count,
  excludeBatchIds = [],
  onConfirm,
  submitting = false,
}: SendToBatchDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState<BatchPosition>('end');

  const availableBatches = eligibleBatches(batches).filter((b) => !excludeBatchIds.includes(b.id));
  const selectedBatches = availableBatches.filter((b) => selectedIds.has(b.id));
  const doneBatches = selectedBatches.filter((b) => b.status === 'DONE');

  useEffect(() => {
    if (open) {
      setStep(1);
      setPosition('end');
      setSelectedIds(new Set());
    }
  }, [open]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = () => {
    if (selectedBatches.length === 0) return;
    onConfirm({ batchIds: selectedBatches.map((b) => b.id), position });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand" />
            {step === 1 ? 'Enviar produtos para lotes' : 'Confirmar posição nos lotes'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Marque um ou mais lotes de destino para os produtos selecionados.'
              : 'Defina onde os novos produtos serão inseridos na fila de cada lote.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            {availableBatches.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-2 p-4 text-center text-sm text-muted-foreground">
                Nenhum lote disponível — crie um lote antes de enviar produtos.
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {availableBatches.map((b) => {
                  const isSelected = selectedIds.has(b.id);
                  return (
                    <label
                      key={b.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm transition-colors',
                        isSelected
                          ? 'border-brand bg-brand/5 ring-1 ring-brand'
                          : 'border-border bg-surface hover:bg-surface-2',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          value={b.id}
                          checked={isSelected}
                          onChange={() => toggle(b.id)}
                          aria-label={b.name}
                          className="text-brand focus:ring-brand"
                        />
                        <div>
                          <div className="font-medium text-foreground">{b.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {b.pending} pendente(s) · {b.total} total
                          </div>
                        </div>
                      </div>
                      <StatusPill
                        label={BATCH_STATUS_LABEL[b.status] ?? b.status}
                        status={b.status}
                      />
                    </label>
                  );
                })}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={selectedBatches.length === 0}
                onClick={() => setStep(2)}
              >
                Avançar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && selectedBatches.length > 0 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm font-medium">
              {`Enviar ${count} produto(s) para ${selectedBatches.map((b) => `«${b.name}»`).join(', ')}`}
            </div>

            {doneBatches.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                {doneBatches.length === 1 ? (
                  <div>
                    O lote «{doneBatches[0]!.name}» está concluído e{' '}
                    <strong>será reativado e voltará a rodar</strong> no próximo horário válido da
                    janela de envio.
                  </div>
                ) : (
                  <div>
                    Os lotes concluídos {doneBatches.map((b) => `«${b.name}»`).join(', ')}{' '}
                    <strong>serão reativados e voltarão a rodar</strong> no próximo horário válido
                    da janela de envio.
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Posição na fila
              </span>
              <div className="space-y-2">
                {POSITIONS.map((p) => (
                  <label
                    key={p.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                      position === p.value
                        ? 'border-brand bg-brand/5 ring-1 ring-brand'
                        : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="radio"
                      name="batch-position"
                      value={p.value}
                      checked={position === p.value}
                      onChange={() => setPosition(p.value)}
                      aria-label={p.label}
                      className="mt-0.5 text-brand focus:ring-brand"
                    />
                    <div>
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Voltar
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Enviando...' : 'Confirmar'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
