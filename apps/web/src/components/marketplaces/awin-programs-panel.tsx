'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAwinFeeds } from '@/lib/queries';
import type { AwinFeed } from '@/lib/types';

type AwinImportResult = {
  feedId: string;
  ok: boolean;
  imported: number;
  removed: number;
  error?: string;
}[];
type AwinImportProgress = {
  phase: 'listing' | 'downloading' | 'importing' | 'completed' | 'cancelling' | 'cancelled';
  feedId?: string;
  feedName?: string;
  feedIndex?: number;
  totalFeeds?: number;
  processedRows?: number;
  estimatedRows?: number | null;
  percent?: number;
};

export function AwinProgramsPanel({ onImported }: { onImported?: () => void }) {
  const { data, isLoading, isError, error: feedsError, refetch, isFetching } = useAwinFeeds(true);
  const feeds = data?.feeds ?? [];
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const [activeImport, setActiveImport] = useState<{
    jobId: string;
    state?: string;
    progress?: AwinImportProgress;
  } | null>(null);

  const showImportResult = useCallback((results: AwinImportResult) => {
    const totalImported = results.reduce((sum, item) => sum + item.imported, 0);
    const failures = results.filter((feed) => !feed.ok);
    const details = failures
      .map((feed) => 'Feed ' + feed.feedId + ': ' + (feed.error ?? 'erro sem detalhe'))
      .join(' · ');
    setFeedback({
      message:
        totalImported === 0
          ? details
            ? 'Nenhum produto foi importado. Erros: ' + details
            : 'Importação concluída, mas nenhum produto novo foi encontrado.'
          : totalImported +
            ' produto(s) importado(s).' +
            (details ? ' ' + failures.length + ' feed(s) falharam: ' + details : ''),
      ok: failures.length === 0 && totalImported > 0,
    });
  }, []);

  useEffect(() => {
    const jobId = window.sessionStorage.getItem('awin-import-job');
    if (jobId) setActiveImport({ jobId });
  }, []);

  useEffect(() => {
    if (!activeImport?.jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await apiFetch<{
          state: string;
          progress: AwinImportProgress | number;
          result?: AwinImportResult;
          error?: string;
        }>('/marketplaces/awin/import/' + encodeURIComponent(activeImport.jobId));
        if (cancelled) return;
        const progress = typeof status.progress === 'object' ? status.progress : undefined;
        if (progress?.phase === 'cancelled') {
          setFeedback({ message: 'Importação cancelada.', ok: true });
          window.sessionStorage.removeItem('awin-import-job');
          setActiveImport(null);
          setCanceling(false);
          return;
        }
        if (status.state === 'completed') {
          showImportResult(status.result ?? []);
          window.sessionStorage.removeItem('awin-import-job');
          setActiveImport(null);
          onImported?.();
          return;
        }
        if (status.state === 'failed') {
          setFeedback({
            message: 'A importação falhou: ' + (status.error ?? 'Erro sem detalhe.'),
            ok: false,
          });
          window.sessionStorage.removeItem('awin-import-job');
          setActiveImport(null);
          return;
        }
        setActiveImport((current) =>
          current?.jobId === activeImport.jobId
            ? { ...current, state: status.state, progress }
            : current,
        );
      } catch (err) {
        if (cancelled) return;
        if (typeof err === 'object' && err !== null && 'status' in err && err.status === 404) {
          setFeedback({
            message:
              'O registro deste job expirou. Atualize a lista de produtos para conferir o catálogo.',
            ok: false,
          });
          window.sessionStorage.removeItem('awin-import-job');
          setActiveImport(null);
          return;
        }
        setFeedback({
          message:
            'Aguardando resposta do job de importação: ' +
            (err instanceof Error ? err.message : 'erro de conexão'),
          ok: false,
        });
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeImport?.jobId, onImported, showImportResult]);

  // Inicializa a seleção local a partir de `selected` do backend assim que os feeds chegam —
  // só uma vez, para não perder o que o usuário já mexeu em refetches subsequentes.
  const effectiveSelected = useMemo(() => {
    if (selected) return selected;
    return new Set(feeds.filter((f) => f.selected).map((f) => f.feedId));
  }, [selected, feeds]);

  const filtered = filter.trim()
    ? feeds.filter((f) => f.advertiserName.toLowerCase().includes(filter.trim().toLowerCase()))
    : feeds;

  function toggle(feedId: string) {
    const next = new Set(effectiveSelected);
    if (next.has(feedId)) next.delete(feedId);
    else next.add(feedId);
    setSelected(next);
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    try {
      await apiFetch('/marketplaces/AWIN', {
        method: 'PUT',
        json: { feedIds: [...effectiveSelected] },
      });
      setFeedback({ message: 'Seleção salva.', ok: true });
      await refetch();
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Falha ao salvar seleção.',
        ok: false,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setFeedback(null);
    try {
      await apiFetch('/marketplaces/AWIN', {
        method: 'PUT',
        json: { feedIds: [...effectiveSelected] },
      });
      const res = await apiFetch<{
        queued: boolean;
        jobId?: string;
        totalImported?: number;
        totalRemoved?: number;
        failedCount?: number;
        feeds?: AwinImportResult;
      }>('/marketplaces/awin/import', { method: 'POST' });
      if (res.queued && res.jobId) {
        window.sessionStorage.setItem('awin-import-job', res.jobId);
        setActiveImport({ jobId: res.jobId, state: 'waiting' });
        setFeedback({
          message: 'Importação na fila. Acompanhando o andamento até concluir...',
          ok: true,
        });
      } else if (res.queued) {
        setFeedback({
          message:
            'Importação enviada, mas não foi possível obter o identificador para acompanhar o job.',
          ok: false,
        });
      } else {
        const results = res.feeds ?? [];
        showImportResult(results);
        onImported?.();
      }
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Falha ao solicitar import.',
        ok: false,
      });
    } finally {
      setImporting(false);
    }
  }

  async function handleCancelImport() {
    if (!activeImport?.jobId) return;
    setCanceling(true);
    try {
      const result = await apiFetch<{ state: string }>(
        '/marketplaces/awin/import/' + encodeURIComponent(activeImport.jobId) + '/cancel',
        { method: 'POST' },
      );
      if (result.state === 'cancelling') {
        setFeedback({ message: 'Cancelamento solicitado. Parando o processamento...', ok: true });
        setActiveImport((current) =>
          current?.jobId === activeImport.jobId
            ? { ...current, progress: { ...current.progress, phase: 'cancelling' } }
            : current,
        );
      } else {
        window.sessionStorage.removeItem('awin-import-job');
        setActiveImport(null);
        setFeedback({ message: 'Importação cancelada.', ok: true });
        setCanceling(false);
      }
    } catch (err) {
      setCanceling(false);
      setFeedback({
        message: err instanceof Error ? err.message : 'Não foi possível cancelar a importação.',
        ok: false,
      });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3.5">
      <p className="mb-2 text-sm font-medium">Programas da Awin</p>

      {(isLoading || (isFetching && !data)) && (
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Conectando à Awin e baixando a lista de programas...
          </p>
          <div
            role="progressbar"
            aria-label="Carregando programas da Awin"
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
          <p className="text-xs text-muted-foreground">
            O carregamento pode levar alguns minutos, dependendo da resposta da Awin.
          </p>
        </div>
      )}
      {isError && (
        <div role="alert" className="space-y-2 text-xs text-red-400">
          <p className="font-medium">Não foi possível carregar a lista de programas da Awin.</p>
          <p className="break-words">
            Detalhe do erro:{' '}
            {feedsError instanceof Error
              ? feedsError.message
              : 'A API não retornou uma descrição do erro.'}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? 'Tentando novamente...' : 'Tentar novamente'}
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <Input
            aria-label="Filtrar programas"
            placeholder="Filtrar por nome..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-2">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum programa encontrado.</p>
            )}
            {filtered.map((f: AwinFeed) => (
              <label key={f.feedId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={effectiveSelected.has(f.feedId)}
                  onChange={() => toggle(f.feedId)}
                />
                <span>
                  {f.advertiserName} · {f.region}
                  {f.productCount != null ? ` · ${f.productCount} produtos` : ''}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {effectiveSelected.size} selecionados
          </p>

          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={handleSave}>
              {saving ? 'Salvando...' : 'Salvar seleção'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={importing || !!activeImport || effectiveSelected.size === 0}
              onClick={handleImport}
            >
              {importing || activeImport ? 'Importando feeds selecionados...' : 'Importar agora'}
            </Button>
            {activeImport && (
              <Button
                type="button"
                variant="outline"
                disabled={canceling || activeImport.progress?.phase === 'cancelling'}
                onClick={handleCancelImport}
              >
                {canceling || activeImport.progress?.phase === 'cancelling'
                  ? 'Cancelando...'
                  : 'Cancelar importação'}
              </Button>
            )}
          </div>

          {(importing || activeImport) && (
            <div role="status" aria-live="polite" className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                A lista está sendo baixada e os produtos são salvos em lotes. O tempo depende do
                tamanho dos feeds.
              </p>
              <div
                role="progressbar"
                aria-label="Importando produtos da Awin"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={activeImport?.progress?.percent}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full bg-primary ${typeof activeImport?.progress?.percent === 'number' ? '' : 'w-1/3 animate-pulse'}`}
                  style={
                    typeof activeImport?.progress?.percent === 'number'
                      ? { width: activeImport.progress.percent + '%' }
                      : undefined
                  }
                />
              </div>
              {activeImport && (
                <p className="text-xs text-muted-foreground">
                  {!activeImport.progress
                    ? activeImport.state === 'active'
                      ? 'Worker iniciou o job; aguardando atualização de progresso...'
                      : activeImport.state === 'delayed'
                        ? 'Importação aguardando liberação da fila...'
                        : 'Na fila, aguardando o worker iniciar...'
                    : null}
                  {activeImport.progress && (
                    <>
                      {activeImport.progress.phase === 'cancelling'
                        ? 'Cancelando importação...'
                        : activeImport.progress.phase === 'listing'
                          ? 'Buscando os feeds selecionados na Awin...'
                          : activeImport.progress.phase === 'downloading'
                            ? 'Baixando ' +
                              (activeImport.progress.feedName ?? 'feed') +
                              ' (' +
                              activeImport.progress.feedIndex +
                              '/' +
                              activeImport.progress.totalFeeds +
                              ')...'
                            : 'Importando ' +
                              (activeImport.progress.feedName ?? 'feed') +
                              ' (' +
                              activeImport.progress.feedIndex +
                              '/' +
                              activeImport.progress.totalFeeds +
                              ')' +
                              (activeImport.progress.processedRows != null
                                ? ': ' +
                                  activeImport.progress.processedRows.toLocaleString('pt-BR') +
                                  (activeImport.progress.estimatedRows
                                    ? ' de ~' +
                                      activeImport.progress.estimatedRows.toLocaleString('pt-BR') +
                                      ' linhas'
                                    : ' linhas processadas')
                                : '')}
                      {typeof activeImport.progress.percent === 'number'
                        ? ' · ' + activeImport.progress.percent + '%'
                        : ''}
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          {feedback && (
            <p
              role={feedback.ok ? 'status' : 'alert'}
              className={`mt-2 break-words text-xs ${feedback.ok ? 'text-emerald-500' : 'text-red-400'}`}
            >
              {feedback.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
