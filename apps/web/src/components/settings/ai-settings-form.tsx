'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { AiSettings, AiSettingsPatch, AiTestResult } from '@/lib/types';

const TONES = [
  ['empolgado', 'Empolgado'],
  ['divertido', 'Divertido'],
  ['urgente', 'Urgente'],
  ['sofisticado', 'Sofisticado'],
] as const;
const EMOJIS = [
  ['poucos', 'Poucos'],
  ['medio', 'Médio'],
  ['muitos', 'Muitos'],
] as const;
const FIELDS = [
  'enabled', 'baseUrl', 'model', 'extraInstructions', 'tone', 'emojiLevel', 'maxChars', 'temperature',
] as const;
const SELECT = 'h-9 w-full rounded-md border border-border bg-surface px-2 text-sm';

type FormState = Omit<AiSettings, 'hasApiKey' | 'apiKeyHint'> & { apiKey: string };
type TestState = { status: 'idle' | 'loading' } | { status: 'ok'; result: AiTestResult } | { status: 'error'; message: string };

export function AiSettingsForm({
  value,
  onSave,
  onTest,
  saving,
}: {
  value: AiSettings;
  onSave: (patch: AiSettingsPatch) => void;
  onTest: (draft: AiSettingsPatch) => Promise<AiTestResult>;
  saving?: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    enabled: value.enabled,
    baseUrl: value.baseUrl,
    model: value.model,
    extraInstructions: value.extraInstructions,
    tone: value.tone,
    emojiLevel: value.emojiLevel,
    maxChars: value.maxChars,
    temperature: value.temperature,
    apiKey: '',
  });
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });

  function changed(): AiSettingsPatch {
    const patch: Record<string, unknown> = {};
    for (const k of FIELDS) if (form[k] !== value[k]) patch[k] = form[k];
    if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
    return patch as AiSettingsPatch;
  }
  function draft(): AiSettingsPatch {
    const { apiKey, ...rest } = form;
    return { ...rest, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch = changed();
    if (Object.keys(patch).length) onSave(patch);
  }
  async function runTest() {
    setTest({ status: 'loading' });
    try {
      setTest({ status: 'ok', result: await onTest(draft()) });
    } catch (e) {
      setTest({ status: 'error', message: e instanceof Error ? e.message : 'Falha ao testar' });
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="ai-enabled"
          aria-label="Ativar CTA com IA"
          checked={form.enabled}
          onCheckedChange={(v) => set('enabled', v)}
        />
        <Label htmlFor="ai-enabled">Ativar CTA com IA</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        A IA só é chamada quando o template da mensagem contém a variável {'{cta}'}. Se a IA
        falhar, a mensagem é enviada sem CTA.
      </p>

      <fieldset className="grid gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">Conexão (9Router)</legend>
        <div>
          <Label htmlFor="ai-base-url">Base URL</Label>
          <Input id="ai-base-url" placeholder="https://seu-vps/v1" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ai-model">Modelo (nome do combo)</Label>
          <Input id="ai-model" value={form.model} onChange={(e) => set('model', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ai-key">API key</Label>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            placeholder={value.apiKeyHint ?? 'sk-…'}
            value={form.apiKey}
            onChange={(e) => set('apiKey', e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Deixe em branco para manter a chave atual.</p>
        </div>
      </fieldset>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Avançado (opcional)</summary>
        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="ai-extra">Instruções extras</Label>
            <Textarea id="ai-extra" rows={3} maxLength={500} value={form.extraInstructions} onChange={(e) => set('extraInstructions', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ai-tone">Tom</Label>
              <select id="ai-tone" className={SELECT} value={form.tone} onChange={(e) => set('tone', e.target.value as FormState['tone'])}>
                {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="ai-emoji">Emojis</Label>
              <select id="ai-emoji" className={SELECT} value={form.emojiLevel} onChange={(e) => set('emojiLevel', e.target.value as FormState['emojiLevel'])}>
                {EMOJIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="ai-max">Máx. de caracteres</Label>
              <Input id="ai-max" type="number" min={40} max={300} value={form.maxChars} onChange={(e) => set('maxChars', Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="ai-temp">Temperature</Label>
              <Input id="ai-temp" type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e) => set('temperature', Number(e.target.value))} />
            </div>
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <Button type="submit" className="bg-brand text-white hover:bg-brand/90" disabled={saving}>
          Salvar
        </Button>
        <Button type="button" variant="outline" onClick={runTest} disabled={test.status === 'loading'}>
          {test.status === 'loading' ? 'Testando…' : 'Testar'}
        </Button>
      </div>
      {test.status === 'ok' && (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm" data-testid="ai-test-result">
          <p>{test.result.cta}</p>
          <p className="mt-1 text-xs text-muted-foreground">{test.result.latencyMs} ms</p>
        </div>
      )}
      {test.status === 'error' && (
        <p role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">
          {test.message}
        </p>
      )}
    </form>
  );
}
