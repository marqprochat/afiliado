'use client';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/queries';

export function ImpersonationBanner() {
  const { data: me } = useMe();
  if (!me?.impersonating) return null;
  async function back() {
    await apiFetch('/admin/impersonation/stop', { method: 'POST' });
    window.location.assign('/afiliados');
  }
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500/20 px-4 py-2 text-sm text-amber-200">
      <span>
        Acessando como <strong>{me.tenant.name}</strong>
      </span>
      <button type="button" onClick={back} className="rounded-md border border-amber-400/50 px-2 py-0.5 hover:bg-amber-500/20">
        Voltar ao admin
      </button>
    </div>
  );
}
