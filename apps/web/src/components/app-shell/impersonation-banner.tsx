'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/queries';

export function ImpersonationBanner() {
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  if (!me?.impersonating) return null;
  async function back() {
    if (busy) return;
    setBusy(true);
    let target = '/afiliados';
    try {
      await apiFetch('/admin/impersonation/stop', { method: 'POST' });
    } catch {
      // A API já limpa a sessão inválida; sem saída pelo stop, o login resolve.
      target = '/login';
    } finally {
      window.location.assign(target);
    }
  }
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500/20 px-4 py-2 text-sm text-amber-200">
      <span>
        Acessando como <strong>{me.tenant.name}</strong>
      </span>
      <button
        type="button"
        onClick={back}
        disabled={busy}
        className="rounded-md border border-amber-400/50 px-2 py-0.5 hover:bg-amber-500/20 disabled:opacity-50"
      >
        Voltar ao admin
      </button>
    </div>
  );
}
