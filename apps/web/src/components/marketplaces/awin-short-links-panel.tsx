'use client';
import { useQueryClient } from '@tanstack/react-query';
import type { AwinLinkQuotaResponse } from '@afilados/shared';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAwinLinkQuota } from '@/lib/queries';

const QUOTA_KEY = ['marketplaces', 'awin', 'links', 'quota'];

function usageText(quota: NonNullable<AwinLinkQuotaResponse['quota']>): string {
  return quota.limit === null
    ? `Links curtos usados hoje: ${quota.usage}`
    : `Links curtos usados hoje: ${quota.usage} de ${quota.limit}`;
}

/** Toggle dos links curtos da Awin no envio (setting `awinShortLinks`) e a cota das últimas 24 h. */
export function AwinShortLinksPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useAwinLinkQuota();
  const save = useApiMutation(
    (enabled: boolean) =>
      apiFetch<{ enabled: boolean }>('/marketplaces/awin/short-links', {
        method: 'PUT',
        json: { enabled },
      }),
    {
      onSuccess: ({ enabled }) => {
        qc.setQueryData<AwinLinkQuotaResponse>(QUOTA_KEY, (old) =>
          old ? { ...old, enabled } : old,
        );
      },
    },
  );
  const enabled = save.isPending ? Boolean(save.variables) : Boolean(data?.enabled);

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Links curtos no envio</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Troca o link longo da Awin (awin1.com) por um link curto (tidd.ly) em cada grupo ou canal.
            Se a cota diária não cobrir todos os canais, a oferta sai com o link longo. Não vale para
            a página do site.
          </p>
        </div>
        <Switch
          aria-label="Links curtos no envio"
          checked={enabled}
          disabled={isLoading || save.isPending}
          onCheckedChange={(v) => save.mutate(v)}
        />
      </div>
      <div className="mt-2 text-xs">
        {isLoading && <p className="text-muted-foreground">Consultando a cota…</p>}
        {isError && <p className="text-red-400">Não foi possível consultar a cota de links curtos.</p>}
        {data?.quota && <p className="text-foreground">{usageText(data.quota)}</p>}
        {data && !data.quota && data.error && (
          <p className="break-words text-red-400">
            Não foi possível consultar a cota de links curtos: {data.error}
          </p>
        )}
        {data && !data.available && (
          <p className="text-muted-foreground">
            Informe o Publisher ID e o token de API da Awin para usar links curtos.
          </p>
        )}
      </div>
    </div>
  );
}
