'use client';
import { useState } from 'react';
import type { MirrorRuleBody } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import type { Template, WaGroup, WaSession } from '@/lib/types';
import { cn } from '@/lib/utils';

const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

export function MirrorRuleForm({
  sessions,
  groups,
  templates,
  onSubmit,
  loading,
  selectedSessionId,
  onSessionChange,
}: {
  sessions: WaSession[];
  groups: WaGroup[];
  templates: Template[];
  onSubmit: (data: MirrorRuleBody) => Promise<void>;
  loading?: boolean;
  selectedSessionId: string;
  onSessionChange: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [sourceJids, setSourceJids] = useState<Set<string>>(new Set());
  const [targetJids, setTargetJids] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'CLONE' | 'TEMPLATE'>('CLONE');
  const [mediaMode, setMediaMode] = useState<'PREVIEW' | 'IMAGE'>('PREVIEW');
  const [templateId, setTemplateId] = useState<string>(
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '',
  );
  const [dedupHours, setDedupHours] = useState(12);

  const toggleSource = (jid: string) => {
    setSourceJids((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else {
        next.add(jid);
        setTargetJids((t) => {
          const tNext = new Set(t);
          tNext.delete(jid);
          return tNext;
        });
      }
      return next;
    });
  };

  const toggleTarget = (jid: string) => {
    setTargetJids((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else {
        next.add(jid);
        setSourceJids((s) => {
          const sNext = new Set(s);
          sNext.delete(jid);
          return sNext;
        });
      }
      return next;
    });
  };

  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(selectedSessionId) &&
    sourceJids.size > 0 &&
    targetJids.size > 0 &&
    (mode !== 'TEMPLATE' || Boolean(templateId));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit({
      name: name.trim(),
      sessionId: selectedSessionId,
      sourceJids: Array.from(sourceJids),
      targetJids: Array.from(targetJids),
      mode,
      mediaMode,
      templateId: mode === 'TEMPLATE' ? templateId : undefined,
      dedupHours,
      enabled: true,
    });
    setName('');
    setSourceJids(new Set());
    setTargetJids(new Set());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold text-foreground">Monitorar novos grupos</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="mirror-name">Nome do monitoramento</Label>
          <Input
            id="mirror-name"
            placeholder="Ex: Espelhar Ofertas Grupo X"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="mirror-session">Sessão do WhatsApp</Label>
          <select
            id="mirror-session"
            className={selectCls}
            value={selectedSessionId}
            onChange={(e) => onSessionChange(e.target.value)}
          >
            <option value="">Selecione uma sessão...</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.phone ?? s.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Grupos de Origem */}
        <div className="space-y-2">
          <Label>
            Grupos de Origem ({sourceJids.size} selecionado{sourceJids.size !== 1 ? 's' : ''})
          </Label>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 space-y-1">
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Nenhum grupo disponível.</p>
            ) : (
              groups.map((g) => (
                <label
                  key={g.jid}
                  className={cn(
                    'flex items-center gap-2 rounded p-1.5 text-sm cursor-pointer hover:bg-surface-3 transition-colors',
                    targetJids.has(g.jid) && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <NativeCheckbox
                    checked={sourceJids.has(g.jid)}
                    disabled={targetJids.has(g.jid)}
                    onChange={() => toggleSource(g.jid)}
                  />
                  <span className="truncate">{g.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Grupos de Destino */}
        <div className="space-y-2">
          <Label>
            Grupos de Destino ({targetJids.size} selecionado{targetJids.size !== 1 ? 's' : ''})
          </Label>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 space-y-1">
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Nenhum grupo disponível.</p>
            ) : (
              groups.map((g) => (
                <label
                  key={g.jid}
                  className={cn(
                    'flex items-center gap-2 rounded p-1.5 text-sm cursor-pointer hover:bg-surface-3 transition-colors',
                    sourceJids.has(g.jid) && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <NativeCheckbox
                    checked={targetJids.has(g.jid)}
                    disabled={sourceJids.has(g.jid)}
                    onChange={() => toggleTarget(g.jid)}
                  />
                  <span className="truncate">{g.name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <Label htmlFor="mirror-mode">Modo</Label>
          <select
            id="mirror-mode"
            className={selectCls}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'CLONE' | 'TEMPLATE')}
          >
            <option value="CLONE">Clone (Reescrever Links)</option>
            <option value="TEMPLATE">Template (Shopee)</option>
          </select>
        </div>

        <div>
          <Label htmlFor="mirror-media">Mídia</Label>
          <select
            id="mirror-media"
            className={selectCls}
            value={mediaMode}
            onChange={(e) => setMediaMode(e.target.value as 'PREVIEW' | 'IMAGE')}
          >
            <option value="PREVIEW">Link Preview</option>
            <option value="IMAGE">Imagem</option>
          </select>
        </div>

        {mode === 'TEMPLATE' && (
          <div>
            <Label htmlFor="mirror-template">Template</Label>
            <select
              id="mirror-template"
              className={selectCls}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isDefault ? '(Padrão)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label htmlFor="mirror-dedup">Deduplicação (Horas)</Label>
          <Input
            id="mirror-dedup"
            type="number"
            min={1}
            max={168}
            className="mt-1"
            value={dedupHours}
            onChange={(e) => setDedupHours(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={!canSubmit || loading}>
          {loading ? 'Adicionando...' : 'Adicionar monitoramento'}
        </Button>
      </div>
    </form>
  );
}
