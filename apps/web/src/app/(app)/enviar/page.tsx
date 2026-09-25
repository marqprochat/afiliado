'use client';
import { useState } from 'react';
import type { BatchFormOutput } from '@/components/queue/batch-form';
import { QueueTable } from '@/components/queue/queue-table';
import { BatchForm } from '@/components/queue/batch-form';
import { BatchList } from '@/components/queue/batch-list';
import { BatchManageDrawer } from '@/components/queue/batch-manage-drawer';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import {
  useBatches,
  useGroups,
  useQueue,
  useSessions,
  useSettings,
  useTemplates,
} from '@/lib/queries';

const INV = [['queue'], ['batches'], ['overview']];

export default function EnviarPage() {
  const { data: queue } = useQueue();
  const { data: sessions } = useSessions();
  const { data: templates } = useTemplates();
  const { data: settings } = useSettings();
  const { data: batches } = useBatches();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const activeSession = sessionId ?? sessions?.find((s) => s.status === 'CONNECTED')?.id ?? null;
  const { data: groups } = useGroups(activeSession);

  const select = useApiMutation(
    (b: { ids: string[]; selected: boolean }) =>
      apiFetch('/queue/select', { method: 'POST', json: b }),
    { invalidate: [['queue']] },
  );
  const remove = useApiMutation((id: string) => apiFetch(`/queue/${id}`, { method: 'DELETE' }), {
    invalidate: [['queue'], ['overview']],
  });
  const clearSent = useApiMutation(() => apiFetch('/queue?status=SENT', { method: 'DELETE' }), {
    invalidate: [['queue'], ['overview']],
    success: 'Enviados removidos',
  });
  const create = useApiMutation(
    (body: BatchFormOutput) => apiFetch('/batches', { method: 'POST', json: body }),
    {
      invalidate: INV,
      success: 'Lote criado e agendado',
    },
  );
  const action = useApiMutation(
    ({ id, a }: { id: string; a: 'pause' | 'resume' | 'cancel' }) =>
      apiFetch(`/batches/${id}/${a}`, { method: 'POST' }),
    { invalidate: INV },
  );
  const [managingId, setManagingId] = useState<string | null>(null);
  const deleteBatch = useApiMutation(
    (id: string) => apiFetch(`/batches/${id}`, { method: 'DELETE' }),
    {
      invalidate: INV,
      success: 'Lote excluído',
      onSuccess: (_out, id) => {
        if (managingId === id) setManagingId(null);
      },
    },
  );

  const selectedCount =
    queue?.items.filter((i) => i.selected && i.status === 'PENDING').length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Enviar Ofertas</h1>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {queue && (
            <QueueTable
              data={queue}
              onSelect={(ids, selected) => select.mutate({ ids, selected })}
              onRemove={(id) => remove.mutate(id)}
              onClearSent={() => clearSent.mutate(undefined)}
            />
          )}
          <section>
            <h2 className="mb-2 font-semibold">Lotes</h2>
            <BatchList
              batches={batches ?? []}
              onPause={(id) => action.mutate({ id, a: 'pause' })}
              onResume={(id) => action.mutate({ id, a: 'resume' })}
              onCancel={(id) => {
                if (confirm('Cancelar este lote?')) action.mutate({ id, a: 'cancel' });
              }}
              onManage={setManagingId}
              onDelete={(id) => deleteBatch.mutate(id)}
            />
            <BatchManageDrawer batchId={managingId} onClose={() => setManagingId(null)} />
          </section>
        </div>
        {sessions && templates && settings && (
          <BatchForm
            sessions={sessions}
            groups={groups ?? []}
            templates={templates}
            settings={settings}
            selectedCount={selectedCount}
            creating={create.isPending}
            onCreate={(b) => create.mutate(b)}
            onSessionChange={setSessionId}
          />
        )}
      </div>
    </div>
  );
}
