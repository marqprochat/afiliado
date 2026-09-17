'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAutomationQueue } from '@/lib/queries';

export function QueuePanel({ ruleId }: { ruleId: string }) {
  const { data: items } = useAutomationQueue(ruleId);
  const [linkUrl, setLinkUrl] = useState('');

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

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Programado para disparar</p>
      <ul className="space-y-1">
        {items?.map((it) => (
          <li
            key={it.id}
            className="flex items-center justify-between rounded border px-2 py-1 text-sm"
          >
            <span>
              {it.manual && <span className="mr-1 rounded bg-blue-100 px-1 text-xs">manual</span>}
              {it.kind === 'PRODUCT' ? it.product?.title : `Cupom ${it.coupon?.code}`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => removeItem.mutate(it.id)}>
              Remover
            </Button>
          </li>
        ))}
        {items?.length === 0 && <li className="text-sm text-gray-400">Nada na fila ainda.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addLink.mutate();
        }}
      >
        <input
          className="flex-1 rounded border px-2 py-1 text-sm"
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
