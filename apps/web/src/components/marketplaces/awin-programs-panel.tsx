'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAwinFeeds } from '@/lib/queries';
import type { AwinFeed } from '@/lib/types';

export function AwinProgramsPanel({ onImported }: { onImported?: () => void }) {
  const { data, isLoading, isError, error: feedsError, refetch, isFetching } = useAwinFeeds(true);
  const feeds = data?.feeds ?? [];
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);

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
        totalImported?: number;
        totalRemoved?: number;
        failedCount?: number;
        feeds?: { feedId: string; ok: boolean; error?: string }[];
      }>('/marketplaces/awin/import', { method: 'POST' });
      if (res.queued) {
        setFeedback({
          message: 'Import solicitado — os produtos aparecem em alguns minutos.',
          ok: true,
        });
      } else if (res.totalImported === 0) {
        const errors = res.feeds?.filter((feed) => !feed.ok) ?? [];
        const details = errors
          .map((feed) => `Feed ${feed.feedId}: ${feed.error ?? 'erro sem detalhe'}`)
          .join(' · ');
        setFeedback({
          message: details
            ? `Nenhum produto foi importado. Erros: ${details}`
            : 'Nenhum produto foi encontrado nos feeds selecionados — verifique o link da lista de feeds ou os programas escolhidos.',
          ok: false,
        });
      } else {
        const failures = res.feeds?.filter((feed) => !feed.ok) ?? [];
        const failureDetails = failures
          .map((feed) => `Feed ${feed.feedId}: ${feed.error ?? 'erro sem detalhe'}`)
          .join(' · ');
        const failedNote = failures.length
          ? ` ${failures.length} feed(s) falharam: ${failureDetails}`
          : '';
        setFeedback({
          message: `${res.totalImported} produto(s) importado(s) pelo link do feed.${failedNote}`,
          ok: failures.length === 0,
        });
      }
      onImported?.();
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Falha ao solicitar import.',
        ok: false,
      });
    } finally {
      setImporting(false);
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
              disabled={importing || effectiveSelected.size === 0}
              onClick={handleImport}
            >
              {importing ? 'Importando feeds selecionados...' : 'Importar agora'}
            </Button>
          </div>

          {importing && (
            <div role="status" aria-live="polite" className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                A lista está sendo baixada e os produtos são salvos em lotes. O tempo depende do
                tamanho dos feeds.
              </p>
              <div
                role="progressbar"
                aria-label="Importando produtos da Awin"
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
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
