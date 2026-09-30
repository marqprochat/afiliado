'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { MarketplaceConnection } from '@/lib/types';

/**
 * Conexão com a API oficial do Mercado Livre (OAuth). O app (Client ID/Secret) fica no servidor;
 * aqui só se inicia a autorização e se mostra o estado. Com a API conectada, colar um link de
 * produto de catálogo (/p/MLB…) preenche título, foto e preço sem raspar a página.
 */
export function MlApiPanel({ connection }: { connection?: MarketplaceConnection }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = Boolean(connection?.hasMlApi);
  const available = connection?.mlApiAvailable ?? false;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { authUrl } = await apiFetch<{ authUrl: string }>(
        '/marketplaces/mercadolivre/oauth/start',
        {
          method: 'POST',
        },
      );
      window.location.assign(authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar a conexão');
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/marketplaces/mercadolivre/oauth', { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['marketplaces'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desconectar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">API oficial do Mercado Livre</p>
        {connected ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
            Conectada
            {connection?.mlApiConnectedAt
              ? ` em ${formatDateTime(connection.mlApiConnectedAt)}`
              : ''}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Não conectada
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Preenche título, foto e preço de produtos de catálogo (links <code>/p/MLB…</code>) sem
        raspar a página, e busca por palavra-chave nas automações. O preço é o de lista: descontos
        de Pix e cupom da página não vêm pela API.
      </p>
      {!available && (
        <p className="mt-2 text-xs text-amber-500">
          Defina <code>ML_CLIENT_ID</code> e <code>ML_CLIENT_SECRET</code> no servidor para poder
          conectar.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={connect} disabled={busy || !available}>
          {connected ? 'Reconectar' : 'Conectar API oficial'}
        </Button>
        {connected && (
          <Button type="button" size="sm" variant="outline" onClick={disconnect} disabled={busy}>
            Desconectar
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
