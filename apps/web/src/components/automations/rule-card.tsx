'use client';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { AutomationRule } from '@/lib/types';
import { QueuePanel } from './queue-panel';

export function RuleCard({ rule }: { rule: AutomationRule }) {
  const toggle = useApiMutation(
    (enabled: boolean) =>
      apiFetch(`/automations/${rule.id}/toggle`, { method: 'POST', json: { enabled } }),
    { invalidate: [['automations']] },
  );

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-muted-foreground">
            {rule.keywords.join(', ')} · a cada {rule.intervalMin}min · limite{' '}
            {rule.maxOffersPerDay}/dia
          </p>
        </div>
        <Button
          variant={rule.enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggle.mutate(!rule.enabled)}
        >
          {rule.enabled ? 'Ligada' : 'Desligada'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
  );
}
