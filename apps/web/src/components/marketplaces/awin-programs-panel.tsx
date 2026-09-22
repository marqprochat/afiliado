'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAwinFeeds } from '@/lib/queries';
import type { AwinFeed } from '@/lib/types';

export function AwinProgramsPanel({ onImported }: { onImported?: () => void }) {
  const { data, isLoading, isError, refetch } = useAwinFeeds(true);
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
      setFeedback({ message: err instanceof Error ? err.message : 'Falha ao salvar seleção.', ok: false });
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
      await apiFetch('/marketplaces/awin/import', { method: 'POST' });
      setFeedback({ message: 'Import solicitado — os produtos aparecem em alguns minutos.', ok: true });
      onImported?.();
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Falha ao solicitar import.', ok: false });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3.5">
      <p className="mb-2 text-sm font-medium">Programas da Awin</p>

      {isLoading && <p className="text-xs text-muted-foreground">Carregando programas...</p>}
      {isError && <p className="text-xs text-red-400">Falha ao carregar os programas da sua conta Awin.</p>}

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
          <p className="mt-2 text-xs text-muted-foreground">{effectiveSelected.size} selecionados</p>

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
              {importing ? 'Importando...' : 'Importar agora'}
            </Button>
          </div>

          {feedback && (
            <p className={`mt-2 text-xs ${feedback.ok ? 'text-emerald-500' : 'text-red-400'}`}>
              {feedback.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
