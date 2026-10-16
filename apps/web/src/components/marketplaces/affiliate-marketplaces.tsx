'use client';
import { useState } from 'react';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useMarketplaces } from '@/lib/queries';
import { MARKETPLACE_CONFIGS } from './marketplace-config';
import { AFFILIATE_SUBID_FIELDS } from './affiliate-subid-fields';

function Row({ kind, saved }: { kind: MarketplaceKind; saved: string }) {
  const [value, setValue] = useState(saved);
  const f = AFFILIATE_SUBID_FIELDS[kind];
  const name = MARKETPLACE_CONFIGS[kind].label;
  const save = useApiMutation(
    (subId: string) => apiFetch(`/marketplaces/${kind}`, { method: 'PUT', json: { subId } }),
    { invalidate: [['marketplaces']], success: `${name} salvo` },
  );
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Label htmlFor={`sub-${kind}`}>{`${f.label} ${name}`}</Label>
      <div className="mt-1 flex gap-2">
        <Input id={`sub-${kind}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" onClick={() => save.mutate(value)} disabled={save.isPending} aria-label={`Salvar ${name}`}>
          Salvar
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>
      {!saved.trim() && (
        <p className="mt-1 text-xs text-amber-500">
          Sem identificador, a comissão deste marketplace não será atribuída a você.
        </p>
      )}
    </div>
  );
}

export function AffiliateMarketplaces() {
  const { data, isPending } = useMarketplaces();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketplaces</h1>
        <p className="text-sm text-muted-foreground">
          As APIs são do administrador. Informe só o seu identificador em cada plataforma.
        </p>
      </div>
      {isPending || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETPLACE_KINDS.map((kind) => {
          const conn = data.find((m) => m.kind === kind);
          return (
            <div key={kind} className="space-y-2">
              <StatusPill label={MARKETPLACE_CONFIGS[kind].label} status={conn?.status ?? 'UNCONFIGURED'} />
              <Row key={`${kind}-${conn?.subId ?? ''}`} kind={kind} saved={conn?.subId ?? ''} />
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
