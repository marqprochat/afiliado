'use client';

import { useState, useEffect } from 'react';
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

export interface SendToBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: BatchSummary[];
  count: number;
  onConfirm: (params: { batchId: string; position: BatchPosition }) => void | Promise<void>;
  submitting?: boolean;
}

export function SendToBatchDialog({
  open,
  onOpenChange,
  batches,
  count,
  onConfirm,
  submitting = false,
}: SendToBatchDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [position, setPosition] = useState<BatchPosition>('end');

  const availableBatches = eligibleBatches(batches);
  const selectedBatch = availableBatches.find((b) => b.id === selectedBatchId) ?? null;

  useEffect(() => {
    if (open) {
      setStep(1);
      setPosition('end');
    }
  }, [open]);

  const handleConfirm = () => {
    if (!selectedBatchId) return;
    onConfirm({ batchId: selectedBatchId, position });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand" />
            {step === 1 ? 'Enviar produtos para lote' : 'Confirmar posição no lote'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Selecione o lote de destino para os produtos selecionados da triagem.'
              : 'Defina onde os novos produtos serão inseridos na fila do lote.'}
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
                  const isSelected = selectedBatchId === b.id;
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
                          type="radio"
                          name="selected-batch"
                          value={b.id}
                          checked={isSelected}
                          onChange={() => setSelectedBatchId(b.id)}
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
                disabled={!selectedBatchId || availableBatches.length === 0}
                onClick={() => setStep(2)}
              >
                Avançar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && selectedBatch && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm font-medium">
              {`Enviar ${count} produto(s) para «${selectedBatch.name}»`}
            </div>

            {selectedBatch.status === 'DONE' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  Este lote está concluído. Ele <strong>será reativado e voltará a rodar</strong> no
                  próximo horário válido da janela de envio.
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Posição na fila
              </label>

              <div className="space-y-2">
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                    position === 'end'
                      ? 'border-brand bg-brand/5 ring-1 ring-brand'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="batch-position"
                    value="end"
                    checked={position === 'end'}
                    onChange={() => setPosition('end')}
                    aria-label="Fim da fila"
                    className="mt-0.5 text-brand focus:ring-brand"
                  />
                  <div>
                    <div className="font-medium">Fim da fila (padrão)</div>
                    <div className="text-xs text-muted-foreground">
                      Os produtos entram após todos os envios pendentes existentes.
                    </div>
                  </div>
                </label>

                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                    position === 'start'
                      ? 'border-brand bg-brand/5 ring-1 ring-brand'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="batch-position"
                    value="start"
                    checked={position === 'start'}
                    onChange={() => setPosition('start')}
                    aria-label="Começo da fila"
                    className="mt-0.5 text-brand focus:ring-brand"
                  />
                  <div>
                    <div className="font-medium">Começo da fila</div>
                    <div className="text-xs text-muted-foreground">
                      Os produtos entram como os próximos a serem enviados pelo lote.
                    </div>
                  </div>
                </label>

                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                    position === 'shuffle'
                      ? 'border-brand bg-brand/5 ring-1 ring-brand'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="batch-position"
                    value="shuffle"
                    checked={position === 'shuffle'}
                    onChange={() => setPosition('shuffle')}
                    aria-label="Embaralhar"
                    className="mt-0.5 text-brand focus:ring-brand"
                  />
                  <div>
                    <div className="font-medium">Embaralhar</div>
                    <div className="text-xs text-muted-foreground">
                      Os novos produtos entram em posições aleatórias entre os pendentes.
                    </div>
                  </div>
                </label>
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
