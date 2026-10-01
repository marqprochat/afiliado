'use client';
import { AiSettingsForm } from '@/components/settings/ai-settings-form';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAiSettings } from '@/lib/queries';
import type { AiSettings, AiSettingsPatch, AiTestResult } from '@/lib/types';

export default function IaPage() {
  const { data } = useAiSettings();
  const save = useApiMutation(
    (patch: AiSettingsPatch) => apiFetch<AiSettings>('/settings/ai', { method: 'PUT', json: patch }),
    { invalidate: [['settings', 'ai']], success: 'Configuração de IA salva' },
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">IA — CTA das mensagens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gera uma frase de chamada para ação única para cada produto, no momento do envio.
        </p>
      </div>
      {data && (
        <AiSettingsForm
          key={JSON.stringify(data)}
          value={data}
          onSave={(p) => save.mutate(p)}
          onTest={(draft) => apiFetch<AiTestResult>('/settings/ai/test', { method: 'POST', json: draft })}
          saving={save.isPending}
        />
      )}
    </div>
  );
}
