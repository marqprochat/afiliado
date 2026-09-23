'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAutomationQueue } from '@/lib/queries';
import type { AutomationQueueItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const MARKETPLACE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
  ALIEXPRESS: 'AliExpress',
  MANUAL: 'Manual',
};

function marketplaceLabel(marketplace: string | null): string {
  if (!marketplace) return '—';
  return MARKETPLACE_LABELS[marketplace] ?? marketplace;
}

/** Link original do item, para teste manual — produto usa originalUrl, cupom usa sourceUrl (pode não existir). */
function itemUrl(it: AutomationQueueItem): string | null {
  if (it.kind === 'PRODUCT') return it.product?.originalUrl ?? null;
  return it.coupon?.sourceUrl ?? null;
}

export function QueuePanel({ ruleId }: { ruleId: string }) {
  const { data: items } = useAutomationQueue(ruleId);
  const [linkUrl, setLinkUrl] = useState('');
  const [order, setOrder] = useState<AutomationQueueItem[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (items) setOrder(items);
  }, [items]);

  const removeItem = useApiMutation(
    (itemId: string) => apiFetch(`/automations/${ruleId}/queue/${itemId}`, { method: 'DELETE' }),
    { invalidate: [['automations', ruleId, 'queue']], success: 'Item removido' },
  );
  const addLink = useApiMutation(
    () => apiFetch(`/automations/${ruleId}/queue/link`, { method: 'POST', json: { url: linkUrl } }),
    {
      invalidate: [['automations', ruleId, 'queue']],
      success: 'Link adicionado à fila',
      onSuccess: () => setLinkUrl(''),
    },
  );

  // Reordenação tem UI otimista (a lista já muda visualmente ao soltar) — em caso de erro,
  // reverte para a última lista confirmada pelo servidor (`items`) em vez de deixar a UI
  // divergente do banco. useApiMutation não dá esse gancho de rollback, então usa useMutation
  // direto aqui, mantendo o mesmo toast de erro que useApiMutation usaria.
  const reorder = useMutation({
    mutationFn: (itemIds: string[]) =>
      apiFetch(`/automations/${ruleId}/queue/order`, { method: 'PATCH', json: { itemIds } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automations', ruleId, 'queue'] });
    },
    onError: (err) => {
      setOrder(items ?? []);
      toast.error(err instanceof ApiClientError ? err.message : 'Erro ao reordenar a fila');
    },
  });

  function handleDrop(dropIndex: number) {
    const dragIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved!);
    setOrder(next);
    reorder.mutate(next.map((i) => i.id));
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Programado para disparar</p>
      <ul className="space-y-1">
        {order.map((it, index) => {
          const url = itemUrl(it);
          return (
            <li
              key={it.id}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              onClick={() => {
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
              }}
              title={url ? 'Clique para abrir o link e testar manualmente' : undefined}
              className={cn(
                'flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm transition-colors',
                url && 'cursor-pointer hover:border-brand/50',
              )}
            >
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <GripVertical
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden
                  onClick={(e) => e.stopPropagation()}
                />
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                  {marketplaceLabel(it.marketplace)}
                </Badge>
                {it.manual && (
                  <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                    manual
                  </Badge>
                )}
                <span className="min-w-0 whitespace-normal break-words">
                  {it.kind === 'PRODUCT' ? it.product?.title : `Cupom ${it.coupon?.code}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem.mutate(it.id);
                }}
              >
                Remover
              </Button>
            </li>
          );
        })}
        {order.length === 0 && (
          <li className="text-sm text-muted-foreground">Nada na fila ainda.</li>
        )}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addLink.mutate();
        }}
      >
        <Input
          className="min-w-0 flex-1"
          placeholder="Colar link de produto…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!linkUrl || addLink.isPending}>
          Adicionar link
        </Button>
      </form>
    </div>
  );
}
