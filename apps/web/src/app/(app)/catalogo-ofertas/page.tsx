'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

type CatalogStatus = {
  products: number;
  awinProducts: number;
  masterProducts: number;
  listings: number;
  latestAwinImport: string | null;
};
type SyncResult = {
  productsProcessed: number;
  awinProcessed: number;
  indexed: number;
  failed: number;
  masterProductsCount: number;
  listingsCount: number;
};

const number = new Intl.NumberFormat('pt-BR');
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function CatalogoOfertasPage() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiFetch<CatalogStatus>('/deals/sync/status'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível consultar o catálogo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function syncCatalog() {
    setSyncing(true);
    setResult(null);
    try {
      const data = await apiFetch<SyncResult>('/deals/sync', { method: 'POST' });
      setResult(data);
      await refresh();
      if (data.failed > 0)
        toast.warning(`Catálogo atualizado com ${data.failed} item(ns) que falharam`);
      else toast.success('Catálogo da vitrine atualizado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao atualizar o catálogo');
    } finally {
      setSyncing(false);
    }
  }

  const stats = [
    ['Produtos salvos', status?.products],
    ['Produtos do catálogo Awin', status?.awinProducts],
    ['Produtos na vitrine', status?.masterProducts],
    ['Ofertas indexadas', status?.listings],
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catálogo da Vitrine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe os produtos disponíveis e envie os itens salvos para a vitrine pública de
          ofertas.
        </p>
      </div>

      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Estado do catálogo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A importação Awin atualiza os feeds periodicamente. A sincronização abaixo publica os
              produtos importados e salvos na vitrine.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/marketplaces"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
            >
              Configurar Awin <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
            <Button variant="outline" onClick={() => void refresh()} disabled={loading || syncing}>
              <RefreshCw className="mr-2 h-4 w-4" /> Atualizar números
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">
                {loading ? '—' : number.format(value ?? 0)}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Última importação Awin:{' '}
          {status?.latestAwinImport
            ? dateTime.format(new Date(status.latestAwinImport))
            : 'ainda não importada'}
        </p>

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <p>
              Reprocessa os produtos salvos e todo o catálogo Awin. Pode levar alguns minutos em
              catálogos grandes.
            </p>
            <p>Outros marketplaces entram aqui quando seus produtos forem salvos no app.</p>
          </div>
          <Button onClick={() => void syncCatalog()} disabled={syncing || loading}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="p-5">
          <div className="flex items-center gap-2 font-semibold">
            {result.failed ? (
              <AlertCircle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            )}
            Resultado da última sincronização
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {number.format(result.productsProcessed)} produtos salvos e{' '}
            {number.format(result.awinProcessed)} itens Awin revisados;{' '}
            {number.format(result.indexed)} indexados com sucesso e {number.format(result.failed)}{' '}
            com falha.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A vitrine agora tem {number.format(result.masterProductsCount)} produtos e{' '}
            {number.format(result.listingsCount)} ofertas.
          </p>
        </Card>
      )}
    </div>
  );
}
