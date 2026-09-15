'use client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { MirrorRule } from '@/lib/types';

export function MirrorRuleList({
  rules,
  onToggle,
  onDelete,
  togglingId,
  deletingId,
}: {
  rules: MirrorRule[];
  onToggle: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  togglingId?: string | null;
  deletingId?: string | null;
}) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Nenhum espelhamento configurado. Adicione um monitoramento acima para começar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-foreground">Espelhamentos configurados ({rules.length})</h3>

      <div className="grid grid-cols-1 gap-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/40"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{rule.name}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                  {rule.mode}
                </span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                  {rule.mediaMode}
                </span>
                {rule.session && (
                  <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                    Sessão: {rule.session.label}
                  </span>
                )}
              </div>

              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Origens: <strong>{rule.sourceJids.length}</strong>
                </span>
                <span>→</span>
                <span>
                  Destinos: <strong>{rule.targetJids.length}</strong>
                </span>
                <span>• Dedup: {rule.dedupHours}h</span>
                {rule.template && <span>• Template: {rule.template.name}</span>}
              </div>

              {rule.counts && (
                <div className="flex items-center gap-3 pt-1 text-xs">
                  <span className="text-emerald-500 font-medium">
                    {rule.counts.mirrored} espelhadas (24h)
                  </span>
                  <span className="text-muted-foreground">{rule.counts.discarded} descartadas</span>
                  {rule.counts.error > 0 && (
                    <span className="text-red-400 font-medium">{rule.counts.error} erros</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 self-end md:self-center">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {rule.enabled ? 'Ativo' : 'Pausado'}
                </span>
                <Switch
                  checked={rule.enabled}
                  disabled={togglingId === rule.id}
                  onCheckedChange={() => onToggle(rule.id)}
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                disabled={deletingId === rule.id}
                onClick={() => onDelete(rule.id)}
              >
                {deletingId === rule.id ? 'Excluindo...' : 'Excluir'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
