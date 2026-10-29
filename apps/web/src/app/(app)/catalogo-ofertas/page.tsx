'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
type AlertProduct = { id: string; title: string; slug: string; alertCount: number };
type AlertSubscriber = {
  id: string;
  recipient: string;
  channel: 'WHATSAPP' | 'EMAIL';
  targetPrice: number | null;
  notifyOnAnyDrop: boolean;
  triggered: boolean;
  createdAt: string;
  masterProduct: { id: string; title: string; slug: string };
};
type AlertsResponse = {
  popular: AlertProduct[];
  matches: AlertProduct[];
  alerts: AlertSubscriber[];
  total: number;
  offset: number;
  pageSize: number;
};

const number = new Intl.NumberFormat('pt-BR');
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CatalogoOfertasPage() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [alertsData, setAlertsData] = useState<AlertsResponse | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsLoadingMore, setAlertsLoadingMore] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<AlertProduct | null>(null);

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

  useEffect(() => {
    let active = true;
    setAlertsLoading(true);
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams();
        if (productQuery.trim().length >= 2) params.set('q', productQuery.trim());
        if (selectedProduct) params.set('productId', selectedProduct.id);
        apiFetch<AlertsResponse>(`/deals/alerts?${params.toString()}`)
          .then((data) => {
            if (active) setAlertsData(data);
          })
          .catch((error) => {
            if (active)
              toast.error(
                error instanceof Error ? error.message : 'Não foi possível carregar os alertas',
              );
          })
          .finally(() => {
            if (active) setAlertsLoading(false);
          });
      },
      productQuery.trim() ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [productQuery, selectedProduct]);

  async function loadMoreAlerts() {
    if (!alertsData || alertsLoadingMore || alertsData.alerts.length >= alertsData.total) return;
    setAlertsLoadingMore(true);
    const params = new URLSearchParams({ offset: String(alertsData.alerts.length) });
    if (productQuery.trim().length >= 2) params.set('q', productQuery.trim());
    if (selectedProduct) params.set('productId', selectedProduct.id);
    try {
      const next = await apiFetch<AlertsResponse>(`/deals/alerts?${params.toString()}`);
      setAlertsData((current) =>
        current ? { ...next, alerts: [...current.alerts, ...next.alerts] } : next,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível carregar mais inscritos',
      );
    } finally {
      setAlertsLoadingMore(false);
    }
  }

  function chooseProduct(product: AlertProduct) {
    setSelectedProduct(product);
    setProductQuery(product.title);
  }

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

      <Card className="p-5">
        <div>
          <h2 className="font-semibold">Alertas de preço</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Veja quem quer receber avisos e quais produtos despertam mais interesse.
          </p>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
          <section>
            <h3 className="mb-3 text-sm font-medium">Produtos mais acompanhados</h3>
            {alertsLoading && !alertsData ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : alertsData?.popular.length ? (
              <ol className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {alertsData.popular.map((product, index) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => chooseProduct(product)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/60 ${selectedProduct?.id === product.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{product.title}</span>
                      <span className="shrink-0 text-xs font-semibold text-primary">
                        {number.format(product.alertCount)}{' '}
                        {product.alertCount === 1 ? 'alerta' : 'alertas'}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Ainda não há inscrições para alertas de preço.
              </p>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                Inscritos {alertsData ? `(${number.format(alertsData.total)})` : ''}
              </h3>
              {selectedProduct && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedProduct(null);
                    setProductQuery('');
                  }}
                >
                  Ver todos <X className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setSelectedProduct(null);
                }}
                placeholder="Pesquisar produto para ver inscritos"
                className="pl-9"
                aria-label="Pesquisar alertas por produto"
              />
              {!selectedProduct && productQuery.trim().length >= 2 && alertsData?.matches.length ? (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {alertsData.matches.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => chooseProduct(product)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate">{product.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {number.format(product.alertCount)} alertas
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {alertsLoading && !alertsData ? (
                <p className="py-5 text-center text-sm text-muted-foreground">
                  Carregando inscritos…
                </p>
              ) : alertsData?.alerts.length ? (
                alertsData.alerts.map((subscriber) => (
                  <div key={subscriber.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-medium">{subscriber.recipient}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {subscriber.masterProduct.title}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {subscriber.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {subscriber.notifyOnAnyDrop
                          ? 'Qualquer queda de preço'
                          : subscriber.targetPrice !== null
                            ? `Alvo: ${currency.format(subscriber.targetPrice)}`
                            : 'Sem preço-alvo'}
                      </span>
                      <span>{dateTime.format(new Date(subscriber.createdAt))}</span>
                      {subscriber.triggered && (
                        <span className="text-emerald-600">Alerta acionado</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  {selectedProduct
                    ? 'Este produto ainda não tem inscritos.'
                    : 'Ainda não há inscrições para mostrar.'}
                </p>
              )}
            </div>

            {alertsData && alertsData.alerts.length < alertsData.total && (
              <div className="mt-3 text-center">
                <Button
                  variant="outline"
                  onClick={() => void loadMoreAlerts()}
                  disabled={alertsLoadingMore}
                >
                  {alertsLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {alertsLoadingMore ? 'Carregando…' : 'Carregar mais inscritos'}
                </Button>
              </div>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}
