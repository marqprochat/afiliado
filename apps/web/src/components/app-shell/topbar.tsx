'use client';
import { useMarketplaces, useSessions } from '@/lib/queries';
import { StatusPill } from './status-pill';

const LABEL: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
};

export function Topbar() {
  const { data: sessions } = useSessions();
  const { data: markets } = useMarketplaces();
  return (
    <header className="flex h-14 items-center justify-center gap-2 border-b border-border bg-surface/60 px-6">
      {(sessions ?? []).length === 0 && <StatusPill label="WhatsApp" status="DISCONNECTED" />}
      {(sessions ?? []).map((s) => (
        <StatusPill key={s.id} label={`WhatsApp · ${s.label}`} status={s.status} />
      ))}
      {(markets ?? []).map((m) => (
        <StatusPill
          key={m.kind}
          label={LABEL[m.kind] ?? m.kind}
          status={m.status}
          title={m.lastError ?? m.status}
        />
      ))}
    </header>
  );
}
