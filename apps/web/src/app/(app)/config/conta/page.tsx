'use client';
import { SettingsForm, type SettingsPatch } from '@/components/settings/settings-form';
import { SiteLinksToggle } from '@/components/settings/site-links-toggle';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useMe, useSettings, useSiteLinks } from '@/lib/queries';

export default function ContaPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isOwner = me ? !me.isAffiliate : false;
  const { data: siteLinks } = useSiteLinks(isOwner);
  const save = useApiMutation(
    (patch: SettingsPatch) => apiFetch('/settings', { method: 'PUT', json: patch }),
    {
      invalidate: [['settings']],
      success: 'Configurações salvas',
    },
  );
  const saveSiteLinks = useApiMutation(
    (enabled: boolean) =>
      apiFetch('/settings/site-links', { method: 'PUT', json: { enabled } }),
    {
      invalidate: [['settings', 'site-links']],
      success: 'Configuração salva',
    },
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Minha Conta</h1>
      {me && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Nome:</span> {me.user.name}
          </p>
          <p>
            <span className="text-muted-foreground">E-mail:</span> {me.user.email}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Alteração de senha disponível na fase F7.
          </p>
        </div>
      )}
      {settings && (
        <SettingsForm
          key={JSON.stringify(settings)}
          value={settings}
          onSave={(p) => save.mutate(p)}
          saving={save.isPending}
        />
      )}
      {isOwner && siteLinks && (
        <SiteLinksToggle
          enabled={siteLinks.enabled}
          onChange={(v) => saveSiteLinks.mutate(v)}
          saving={saveSiteLinks.isPending}
        />
      )}
    </div>
  );
}
