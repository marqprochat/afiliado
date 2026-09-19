'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { AutomationRule } from '@/lib/types';
import { QueuePanel } from './queue-panel';

export function RuleCard({ rule }: { rule: AutomationRule }) {
  const [open, setOpen] = useState(false);
  const toggle = useApiMutation(
    (enabled: boolean) =>
      apiFetch(`/automations/${rule.id}/toggle`, { method: 'POST', json: { enabled } }),
    { invalidate: [['automations']] },
  );
  const remove = useApiMutation(
    () => apiFetch(`/automations/${rule.id}`, { method: 'DELETE' }),
    { invalidate: [['automations']], success: 'Automação excluída' },
  );

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{rule.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {rule.keywords.join(', ')} · a cada {rule.intervalMin}min · limite{' '}
              {rule.maxOffersPerDay}/dia
            </p>
          </div>
        </button>
        <Button
          variant={rule.enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggle.mutate(!rule.enabled)}
        >
          {rule.enabled ? 'Ligada' : 'Desligada'}
        </Button>
        <Button
          variant="destructive"
          size="icon-sm"
          aria-label="Excluir automação"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm(`Excluir a automação "${rule.name}"? Essa ação não pode ser desfeita.`)) {
              remove.mutate(undefined);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <div className="border-t border-border p-3 pt-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Frescos p/ enviar: {rule.stats.freshCount}</span>
            <span>Buscados hoje: {rule.stats.discoveredToday}</span>
            <span>
              Último disparo:{' '}
              {rule.stats.lastDispatchedAt
                ? new Date(rule.stats.lastDispatchedAt).toLocaleString('pt-BR')
                : 'Nunca'}
            </span>
          </div>
          <QueuePanel ruleId={rule.id} />
        </div>
      )}
    </div>
  );
}
