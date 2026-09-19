'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { RealtimeEvent } from '@afilados/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useRealtime } from '@/lib/realtime';
import type { WaGroup } from '@/lib/types';

type GroupDetailsEvent = Extract<RealtimeEvent, { type: 'wa.group.details' }>;

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;

export function GroupCard({ sessionId, group }: { sessionId: string; group: WaGroup }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(group.description ?? '');
  const [newPhone, setNewPhone] = useState('');
  const [details, setDetails] = useState<GroupDetailsEvent | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useRealtime((e) => {
    if (e.type === 'wa.group.action' && e.jid === group.jid && !e.ok) {
      toast.error(e.error ?? 'Falha na ação do grupo');
    }
    if (e.type === 'wa.group.details' && e.jid === group.jid) {
      setLoadingDetails(false);
      if (e.ok) setDetails(e);
      else toast.error(e.error ?? 'Falha ao buscar detalhes');
    }
  });

  const saveSettings = useApiMutation(
    (body: { subject?: string; description?: string; announceOnly?: boolean }) =>
      apiFetch(`/wa/sessions/${sessionId}/groups/${encodeURIComponent(group.jid)}`, {
        method: 'PATCH',
        json: body,
      }),
    { invalidate: [['wa', 'groups']], success: 'Alteração enviada' },
  );
  const invite = useApiMutation(
    (revoke: boolean) =>
      apiFetch(`/wa/sessions/${sessionId}/groups/${encodeURIComponent(group.jid)}/invite`, {
        method: 'POST',
        json: { revoke },
      }),
    { invalidate: [['wa', 'groups']], success: 'Link enviado — deve atualizar em instantes' },
  );
  const participants = useApiMutation(
    (body: { action: 'add' | 'remove' | 'promote' | 'demote'; participants: string[] }) =>
      apiFetch(`/wa/sessions/${sessionId}/groups/${encodeURIComponent(group.jid)}/participants`, {
        method: 'POST',
        json: body,
      }),
    { invalidate: [['wa', 'groups']], success: 'Alteração de participante enviada' },
  );

  function fetchDetails() {
    setLoadingDetails(true);
    void apiFetch(`/wa/sessions/${sessionId}/groups/${encodeURIComponent(group.jid)}/details`, {
      method: 'POST',
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">
              <span className="mr-2 text-xs text-muted-foreground">{PREFIX[group.kind]}</span>
              {group.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{group.memberCount} membros</p>
          </div>
        </button>
        {group.botIsAdmin ? (
          <Badge className="bg-brand/20 text-brand">Admin</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">membro</span>
        )}
      </div>

      {open && (
        <div className="space-y-4 border-t border-border p-3 pt-3">
          {!group.botIsAdmin && (
            <p className="text-xs text-muted-foreground">
              O bot não é admin deste grupo — só é possível visualizar, não gerenciar.
            </p>
          )}

          {group.botIsAdmin && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Descrição</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Descrição do grupo…"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saveSettings.isPending}
                  onClick={() => saveSettings.mutate({ description })}
                >
                  Salvar descrição
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Somente admins enviam mensagem</span>
                <Switch
                  checked={group.announceOnly ?? false}
                  disabled={saveSettings.isPending}
                  onCheckedChange={(checked) => saveSettings.mutate({ announceOnly: checked })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Link de convite</label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={group.inviteLink ?? 'Nenhum link gerado ainda'}
                    className="flex-1 text-xs"
                  />
                  {group.inviteLink && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label="Copiar link"
                      onClick={() => void navigator.clipboard.writeText(group.inviteLink!)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={invite.isPending}
                    onClick={() => invite.mutate(!!group.inviteLink)}
                  >
                    {group.inviteLink ? 'Revogar e gerar novo' : 'Gerar link'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Participantes</label>
                  <Button size="sm" variant="outline" disabled={loadingDetails} onClick={fetchDetails}>
                    {loadingDetails ? 'Carregando…' : details ? 'Atualizar' : 'Ver participantes'}
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Telefone com DDI (ex.: 5511999999999)"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={!newPhone.trim() || participants.isPending}
                    onClick={() => {
                      participants.mutate({ action: 'add', participants: [newPhone.trim()] });
                      setNewPhone('');
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>

                {details && (
                  <ul className="space-y-1">
                    {details.participants?.map((p) => (
                      <li
                        key={p.jid}
                        className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-2 py-1 text-sm"
                      >
                        <span className="flex items-center gap-1.5">
                          {p.jid.split('@')[0]}
                          {p.admin && (
                            <Badge variant="secondary" className="text-[10px]">
                              {p.admin === 'superadmin' ? 'criador' : 'admin'}
                            </Badge>
                          )}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={participants.isPending}
                            onClick={() =>
                              participants.mutate({
                                action: p.admin ? 'demote' : 'promote',
                                participants: [p.jid.split('@')[0]!],
                              })
                            }
                          >
                            {p.admin ? 'Remover admin' : 'Tornar admin'}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="destructive"
                            aria-label="Remover do grupo"
                            disabled={participants.isPending}
                            onClick={() =>
                              participants.mutate({ action: 'remove', participants: [p.jid.split('@')[0]!] })
                            }
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
