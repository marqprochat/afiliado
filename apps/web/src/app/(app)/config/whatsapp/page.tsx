'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SessionCard } from '@/components/whatsapp/session-card';
import { GroupsList } from '@/components/whatsapp/groups-list';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useSessions } from '@/lib/queries';

const INV = [['wa'], ['overview']];

export default function WhatsappPage() {
  const { data: sessions } = useSessions();
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const create = useApiMutation(
    (body: { label: string }) => apiFetch('/wa/sessions', { method: 'POST', json: body }),
    { invalidate: INV, success: 'Sessão criada' },
  );
  const cmd = useApiMutation(
    ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      apiFetch(`/wa/sessions/${id}/${action}`, { method: 'POST', json: body ?? {} }),
    { invalidate: INV },
  );
  const del = useApiMutation((id: string) => apiFetch(`/wa/sessions/${id}`, { method: 'DELETE' }), {
    invalidate: INV,
    success: 'Sessão excluída',
  });

  const current = sessions?.find((s) => s.id === selected) ?? sessions?.[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">WhatsApp</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) {
            create.mutate({ label: label.trim() });
            setLabel('');
          }
        }}
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nome da sessão (ex.: Chip 1)"
          className="max-w-xs"
        />
        <Button type="submit" className="bg-brand text-white hover:bg-brand/90">
          Adicionar sessão
        </Button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {(sessions ?? []).map((s) => (
          <div key={s.id} onClick={() => setSelected(s.id)}>
            <SessionCard
              session={s}
              onConnect={(id, body) => cmd.mutate({ id, action: 'connect', body })}
              onDisconnect={(id) => cmd.mutate({ id, action: 'disconnect' })}
              onLogout={(id) => cmd.mutate({ id, action: 'logout' })}
              onSync={(id) => cmd.mutate({ id, action: 'sync-groups' })}
              onDelete={(id) => {
                if (confirm('Excluir esta sessão?')) del.mutate(id);
              }}
            />
          </div>
        ))}
        {sessions?.length === 0 && (
          <p className="text-muted-foreground">
            Nenhuma sessão. Adicione uma para conectar seu WhatsApp.
          </p>
        )}
      </div>

      {current && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Grupos de “{current.label}”</h2>
          <GroupsList sessionId={current.id} />
        </section>
      )}
    </div>
  );
}
