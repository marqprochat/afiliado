'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Settings } from '@/lib/types';

export type SettingsPatch = Partial<Omit<Settings, 'window'>> & {
  window?: Partial<Settings['window']>;
};

export function SettingsForm({
  value,
  onSave,
  saving,
}: {
  value: Settings;
  onSave: (patch: SettingsPatch) => void;
  saving?: boolean;
}) {
  const [form, setForm] = useState<Settings>(value);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch: SettingsPatch = {};
    const w: Record<string, unknown> = {};
    (['startTime', 'endTime', 'timezone', 'enabled'] as const).forEach((k) => {
      if (form.window[k] !== value.window[k]) w[k] = form.window[k];
    });
    if (Object.keys(w).length) patch.window = w as Partial<Settings['window']>;
    (['queueLimit', 'globalRateLimitPerMin', 'subIdPattern'] as const).forEach((k) => {
      if (form[k] !== value[k]) (patch as Record<string, unknown>)[k] = form[k];
    });
    if (Object.keys(patch).length) onSave(patch);
  }

  const num =
    (k: 'queueLimit' | 'globalRateLimitPerMin') => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: Number(e.target.value) });
  const win = (k: 'startTime' | 'endTime') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, window: { ...form.window, [k]: e.target.value } });

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">Janela de operação</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="start">Início</Label>
            <Input
              id="start"
              type="time"
              value={form.window.startTime}
              onChange={win('startTime')}
            />
          </div>
          <div>
            <Label htmlFor="end">Fim</Label>
            <Input id="end" type="time" value={form.window.endTime} onChange={win('endTime')} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Switch
            id="enabled"
            checked={form.window.enabled}
            onCheckedChange={(v) => setForm({ ...form, window: { ...form.window, enabled: v } })}
          />
          <Label htmlFor="enabled">Respeitar janela (bot “dorme” fora dela)</Label>
        </div>
      </fieldset>
      <div>
        <Label htmlFor="queueLimit">Limite da fila</Label>
        <Input
          id="queueLimit"
          type="number"
          min={1}
          value={form.queueLimit}
          onChange={num('queueLimit')}
        />
      </div>
      <div>
        <Label htmlFor="rate">Máximo de mensagens por minuto (por sessão)</Label>
        <Input
          id="rate"
          type="number"
          min={1}
          max={60}
          value={form.globalRateLimitPerMin}
          onChange={num('globalRateLimitPerMin')}
        />
      </div>
      <div>
        <Label htmlFor="subid">Padrão de SubID</Label>
        <Input
          id="subid"
          value={form.subIdPattern}
          onChange={(e) => setForm({ ...form, subIdPattern: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Tokens: {'{yyyyMMdd} {HHmm} {batchId} {group}'}
        </p>
      </div>
      <Button
        type="submit"
        disabled={saving}
        className="w-fit bg-brand text-white hover:bg-brand/90"
      >
        Salvar
      </Button>
    </form>
  );
}
