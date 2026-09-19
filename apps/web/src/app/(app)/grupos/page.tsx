'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { GroupCard } from '@/components/groups/group-card';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useGroups, useSessions } from '@/lib/queries';

const selectCls = 'h-9 rounded-md border border-input bg-surface-2 px-2 text-sm';

export default function GruposPage() {
  const { data: sessions = [] } = useSessions();
  const connected = sessions.filter((s) => s.status === 'CONNECTED');
  const [sessionId, setSessionId] = useState('');
  const effectiveSessionId = sessionId || connected[0]?.id || '';
  const { data: groups } = useGroups(effectiveSessionId || null);

  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState('');
  const [participantsText, setParticipantsText] = useState('');

  const create = useApiMutation(
    () =>
      apiFetch(`/wa/sessions/${effectiveSessionId}/groups`, {
        method: 'POST',
        json: {
          subject,
          participants: participantsText
            .split(/[\n,]/)
            .map((p) => p.trim())
            .filter(Boolean),
        },
      }),
    {
      invalidate: [['wa', 'groups']],
      success: 'Criação enviada — o grupo deve aparecer na lista em instantes',
      onSuccess: () => {
        setSubject('');
        setParticipantsText('');
        setShowCreate(false);
      },
    },
  );

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Grupos</h1>
        <Button
          variant={showCreate ? 'outline' : 'default'}
          size="sm"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancelar' : '+ Novo grupo'}
        </Button>
      </div>

      <div className="flex max-w-xs flex-col gap-1">
        <Label htmlFor="grupos-session">Sessão do WhatsApp</Label>
        <select
          id="grupos-session"
          className={selectCls}
          value={effectiveSessionId}
          onChange={(e) => setSessionId(e.target.value)}
        >
          <option value="">Selecione uma sessão…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.phone ?? s.status})
            </option>
          ))}
        </select>
      </div>

      {showCreate && (
        <form
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!effectiveSessionId || !subject.trim()) return;
            create.mutate(undefined);
          }}
        >
          <div>
            <Label htmlFor="group-subject">Nome do grupo</Label>
            <Input
              id="group-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
              maxLength={25}
              placeholder="Ex.: Ofertas 1"
            />
          </div>
          <div>
            <Label htmlFor="group-participants">Participantes iniciais</Label>
            <Textarea
              id="group-participants"
              value={participantsText}
              onChange={(e) => setParticipantsText(e.target.value)}
              className="mt-1"
              placeholder={'Um número por linha ou separado por vírgula, com DDI\nEx.: 5511999999999'}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O WhatsApp exige pelo menos um participante além de você para criar o grupo.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!effectiveSessionId || !subject.trim() || create.isPending}
            className="bg-brand text-white hover:bg-brand/90"
          >
            {create.isPending ? 'Enviando…' : 'Criar grupo'}
          </Button>
        </form>
      )}

      <div className="space-y-2">
        {groups?.map((g) => (
          <GroupCard key={g.jid} sessionId={effectiveSessionId} group={g} />
        ))}
        {groups?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum grupo sincronizado ainda para essa sessão. Conecte e sincronize em
            “Configurações → WhatsApp”.
          </p>
        )}
        {!effectiveSessionId && (
          <p className="text-sm text-muted-foreground">Selecione uma sessão conectada.</p>
        )}
      </div>
    </div>
  );
}
