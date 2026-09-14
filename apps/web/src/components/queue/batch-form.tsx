'use client';
import { useMemo, useState } from 'react';
import { isWithinOperatingWindow, scheduleBatch } from '@afilados/core';
import type { BatchCreateBody } from '@afilados/shared';

export type BatchFormOutput = Omit<BatchCreateBody, 'productIds'>;
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/format';
import type { Settings, Template, WaGroup, WaSession } from '@/lib/types';
import { cn } from '@/lib/utils';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;
const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

export function BatchForm({
  sessions,
  groups,
  templates,
  settings,
  selectedCount,
  onCreate,
  creating,
  onSessionChange,
}: {
  sessions: WaSession[];
  groups: WaGroup[];
  templates: Template[];
  settings: Settings;
  selectedCount: number;
  onCreate: (body: BatchFormOutput) => void;
  creating?: boolean;
  onSessionChange?: (id: string) => void;
}) {
  const connected = sessions.filter((s) => s.status === 'CONNECTED');
  const [name, setName] = useState('');
  const [sessionId, setSessionId] = useState(connected[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '',
  );
  const [jids, setJids] = useState<Set<string>>(new Set());
  const [intervalMin, setIntervalMin] = useState(10);
  const [mediaMode, setMediaMode] = useState<'IMAGE' | 'PREVIEW'>('IMAGE');
  const [shuffled, setShuffled] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [selectedCount, intervalMin]);
  const schedule = useMemo(
    () => scheduleBatch(selectedCount, Math.max(1, intervalMin), settings.window, now),
    [selectedCount, intervalMin, settings.window, now],
  );
  const outside = !isWithinOperatingWindow(now, settings.window);
  const canCreate =
    !!name.trim() &&
    !!sessionId &&
    !!templateId &&
    jids.size > 0 &&
    selectedCount > 0 &&
    intervalMin >= 1;

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate)
          onCreate({
            name: name.trim(),
            sessionId,
            templateId,
            groupJids: [...jids],
            intervalMin,
            mediaMode,
            shuffled,
          });
      }}
    >
      <h2 className="font-semibold">Personalização do disparo</h2>
      <div>
        <Label htmlFor="bname">Nome do lote</Label>
        <Input
          id="bname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Ofertas da manhã"
        />
      </div>
      <div>
        <Label htmlFor="bsession">Sessão WhatsApp</Label>
        <select
          id="bsession"
          value={sessionId}
          onChange={(e) => {
            setSessionId(e.target.value);
            setJids(new Set());
            onSessionChange?.(e.target.value);
          }}
          className={selectCls}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>
              {s.label} {s.status !== 'CONNECTED' ? `(${s.status})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Grupos ({jids.size})</Label>
        <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum grupo — sincronize em Configurações → WhatsApp.
            </p>
          )}
          {groups.map((g) => (
            <label key={g.jid} className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={jids.has(g.jid)}
                onChange={(e) => {
                  const s = new Set(jids);
                  if (e.target.checked) s.add(g.jid);
                  else s.delete(g.jid);
                  setJids(s);
                }}
                aria-label={`${PREFIX[g.kind]} ${g.name}`}
              />
              <span className="text-xs text-muted-foreground">{PREFIX[g.kind]}</span> {g.name}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="binterval">Intervalo (minutos entre envios)</Label>
          <Input
            id="binterval"
            type="number"
            min={1}
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Formato de mídia</Label>
          <div className="mt-1 flex rounded-md border border-border p-0.5 text-sm">
            {(['IMAGE', 'PREVIEW'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMediaMode(m)}
                className={cn('flex-1 rounded px-2 py-1', mediaMode === m && 'bg-brand text-white')}
              >
                {m === 'IMAGE' ? 'Imagem' : 'Preview'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {mediaMode === 'IMAGE'
              ? 'Imagem + legenda (ocupa a galeria do cliente).'
              : 'Link com pré-visualização (não lota a galeria).'}
          </p>
        </div>
      </div>
      <div>
        <Label htmlFor="btemplate">Template</Label>
        <select
          id="btemplate"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className={selectCls}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isDefault ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="shuffle" checked={shuffled} onCheckedChange={setShuffled} />
        <Label htmlFor="shuffle">Embaralhar ordem dos produtos</Label>
      </div>
      <div className="rounded-md bg-surface-2 p-3 text-sm">
        <p>
          {selectedCount} produto(s) selecionado(s) × {jids.size} grupo(s)
        </p>
        <p>
          Previsão de término:{' '}
          <b>{schedule.estimatedEndAt ? formatDateTime(schedule.estimatedEndAt) : '—'}</b>
        </p>
        {outside && (
          <p className="text-amber-300">
            Fora da janela de operação agora — o 1º envio sai às {settings.window.startTime}.
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full bg-brand text-white hover:bg-brand/90"
        disabled={!canCreate || creating}
      >
        Criar lote
      </Button>
    </form>
  );
}
