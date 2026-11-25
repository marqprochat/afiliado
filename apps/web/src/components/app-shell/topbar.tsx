'use client';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useMarketplaces, useSessions } from '@/lib/queries';
import { Sidebar } from './sidebar';
import { StatusPill } from './status-pill';
import { awinTokenAlert } from '@/lib/awin-token-alert';

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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="flex min-h-14 items-center gap-2 border-b border-border bg-surface/60 px-3 sm:px-6 py-2">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground hover:bg-surface md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex flex-1 flex-wrap items-center justify-start gap-1.5 sm:justify-center sm:gap-2">
          {(sessions ?? []).length === 0 && <StatusPill label="WhatsApp" status="DISCONNECTED" />}
          {(sessions ?? []).map((s) => (
            <StatusPill key={s.id} label={`WhatsApp · ${s.label}`} status={s.status} />
          ))}
          {(markets ?? []).map((m) => {
            // Status ERROR real tem prioridade; senão, avisa token da Awin perto de vencer/vencido.
            const alert = m.kind === 'AWIN' && m.status !== 'ERROR' ? awinTokenAlert(m) : null;
            return (
              <StatusPill
                key={m.kind}
                label={LABEL[m.kind] ?? m.kind}
                status={m.status}
                {...(alert ? { tone: alert.tone } : {})}
                title={alert?.message ?? m.lastError ?? m.status}
              />
            );
          })}
        </div>
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 flex h-full">
            <Sidebar className="h-full" onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
              className="ml-2 mt-3 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-foreground shadow"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
