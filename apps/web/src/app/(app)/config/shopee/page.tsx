'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useMarketplaces } from '@/lib/queries';

const INV = [['marketplaces'], ['overview']];

export default function ShopeePage() {
  const { data } = useMarketplaces();
  const conn = data?.find((m) => m.kind === 'SHOPEE');
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [tag, setTag] = useState('');
  const save = useApiMutation(
    (body: Record<string, string>) =>
      apiFetch('/marketplaces/SHOPEE', { method: 'PUT', json: body }),
    { invalidate: INV, success: 'Credenciais salvas', onSuccess: () => setSecret('') },
  );
  const check = useApiMutation(() => apiFetch('/marketplaces/SHOPEE/check', { method: 'POST' }), {
    invalidate: INV,
    success: 'Conexão verificada',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    if (appId) body.appId = appId;
    if (secret) body.secret = secret;
    if (tag) body.affiliateTag = tag;
    if (Object.keys(body).length) save.mutate(body);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">API Shopee</h1>
        {conn && <StatusPill label={conn.status} status={conn.status} />}
      </div>
      <p className="text-sm text-muted-foreground">
        Credenciais da Shopee Affiliate Open Platform. O secret é criptografado e nunca é exibido de
        volta.
      </p>
      <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <Label htmlFor="appId">App Key</Label>
          <Input
            id="appId"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={conn?.appId ?? ''}
          />
        </div>
        <div>
          <Label htmlFor="secret">Secret</Label>
          <Input
            id="secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={conn?.hasSecret ? '•••••••• (já salvo)' : ''}
          />
        </div>
        <div>
          <Label htmlFor="tag">Tag de afiliado</Label>
          <Input
            id="tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={conn?.affiliateTag ?? ''}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="submit"
            className="bg-brand text-white hover:bg-brand/90"
            disabled={save.isPending}
          >
            Salvar
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => check.mutate(undefined)}
            disabled={check.isPending || !conn?.hasSecret}
          >
            Testar conexão
          </Button>
        </div>
      </form>
      {conn && (
        <div className="text-sm text-muted-foreground">
          <p>Última verificação: {formatDateTime(conn.lastCheckedAt)}</p>
          {conn.lastError && <p className="text-red-300">Erro: {conn.lastError}</p>}
        </div>
      )}
    </div>
  );
}
