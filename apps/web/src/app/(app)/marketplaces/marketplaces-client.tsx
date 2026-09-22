'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { useMarketplaces } from '@/lib/queries';
import {
  MarketplaceDrawer,
  type MarketplaceSubmitPayload,
  type MarketplaceFeedback,
} from '@/components/marketplaces/marketplace-drawer';
import { MARKETPLACE_CONFIGS } from '@/components/marketplaces/marketplace-config';
import type { MarketplaceConnection } from '@/lib/types';

export function MarketplacesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: marketplaces = [], refetch } = useMarketplaces();
  const openKind = searchParams.get('open') as MarketplaceKind | null;
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<MarketplaceFeedback | null>(null);

  function openDrawer(kind: MarketplaceKind) {
    setFeedback(null);
    router.replace(`/marketplaces?open=${kind}`);
  }
  function closeDrawer() {
    router.replace('/marketplaces');
  }

  async function handleSubmit(kind: MarketplaceKind, payload: MarketplaceSubmitPayload) {
    setPending(true);
    setFeedback(null);
    try {
      if (Object.keys(payload.fields).length > 0) {
        await apiFetch(`/marketplaces/${kind}`, { method: 'PUT', json: payload.fields });
      }
      if (payload.cookie) {
        await apiFetch(`/marketplaces/${kind}/session`, {
          method: 'POST',
          json: { cookie: payload.cookie },
        });
      }
      const result = await apiFetch<MarketplaceConnection>(`/marketplaces/${kind}/check`, {
        method: 'POST',
      });
      setFeedback({
        message:
          result.status === 'OK'
            ? 'Conexão validada com sucesso!'
            : (result.lastError ?? 'Falha na validação das credenciais.'),
        ok: result.status === 'OK',
      });
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Falha ao salvar/testar a conexão.',
        ok: false,
      });
    } finally {
      await refetch();
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketplaces</h1>
        <p className="text-sm text-muted-foreground">Configure suas credenciais de afiliado.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETPLACE_KINDS.map((kind) => {
          const conn = marketplaces.find((m) => m.kind === kind);
          const config = MARKETPLACE_CONFIGS[kind];
          const status = conn?.status ?? 'UNCONFIGURED';
          return (
            <div key={kind} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-semibold">{config.label}</h2>
                <StatusPill label={status} status={status} />
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{config.description}</p>
              <Button variant="outline" onClick={() => openDrawer(kind)}>
                Configurar marketplace
              </Button>
            </div>
          );
        })}
      </div>

      {openKind && MARKETPLACE_KINDS.includes(openKind) && (
        <MarketplaceDrawer
          kind={openKind}
          connection={marketplaces.find((m) => m.kind === openKind)}
          open
          onOpenChange={(v) => {
            if (!v) closeDrawer();
          }}
          onSubmit={(payload) => handleSubmit(openKind, payload)}
          pending={pending}
          feedback={feedback}
        />
      )}
    </div>
  );
}
