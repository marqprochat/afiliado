'use client';
import { useState } from 'react';
import { Copy, ExternalLink, Link2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useGroupLinkHistory } from '@/lib/queries';
import { useApiMutation } from '@/lib/mutations';
import { apiFetch } from '@/lib/api';
import { ConfirmActionDialog } from './confirm-action-dialog';
import type { GroupLink, ManagedGroup, ManagedGroupStatus } from '@/lib/types';

interface GroupLinkHistoryDialogProps {
  groupLink: GroupLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_BADGES: Record<ManagedGroupStatus, React.ReactNode> = {
  ACTIVE: <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">ATIVO</Badge>,
  FULL: <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30">CHEIO</Badge>,
  ORPHANED: <Badge className="bg-red-500/15 text-red-400 border-red-500/30">ÓRFÃO</Badge>,
  CREATING: <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">CRIANDO</Badge>,
  STANDBY: <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30">EM ESPERA</Badge>,
};

export function GroupLinkHistoryDialog({
  groupLink,
  open,
  onOpenChange,
}: GroupLinkHistoryDialogProps) {
  const { data: groups = [], isLoading } = useGroupLinkHistory(groupLink?.id ?? null);

  const [pointTarget, setPointTarget] = useState<ManagedGroup | null>(null);
  const rotateAt = groupLink ? Math.max(1, groupLink.memberLimit - groupLink.rotateMargin) : 0;
  const activeGroup = groups.find((g) => g.status === 'ACTIVE') ?? null;

  const pointMutation = useApiMutation(
    (groupId: string) =>
      apiFetch(`/group-links/${groupLink?.id}/point`, { method: 'POST', json: { groupId } }),
    {
      invalidate: [['group-links']],
      success: 'Link apontado para o grupo selecionado!',
      onSuccess: () => setPointTarget(null),
    },
  );

  const canPoint = (g: ManagedGroup) =>
    g.status !== 'ACTIVE' &&
    g.status !== 'CREATING' &&
    g.status !== 'ORPHANED' &&
    !!g.jid &&
    g.memberCount < rotateAt;

  const copyInvite = async (link: string) => {
    await copyToClipboard(link);
    toast.success('Link de convite copiado!');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl lg:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand" />
            Histórico de Grupos — {groupLink?.label}
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground mb-3">
          Slug:{' '}
          <code className="bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
            /g/{groupLink?.slug}
          </code>{' '}
          • Limite por grupo: {groupLink?.memberLimit} membros • Troca em {rotateAt}
        </div>
        <div className="text-xs text-muted-foreground mb-3 rounded-md border border-border bg-surface-2/60 p-2.5">
          Todos os grupos deste link são <strong className="text-foreground">vinculados</strong>:
          qualquer envio para um deles também vai para os demais. Use{' '}
          <strong className="text-foreground">Apontar link aqui</strong> para fazer o link voltar a
          encher um grupo que ainda tem vagas — o grupo atual fica em espera e é reaproveitado na
          próxima troca, sem criar um novo.
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Carregando histórico...
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhum grupo registrado ainda para este link fixo.
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group: ManagedGroup) => (
              <div
                key={group.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-muted-foreground">
                      #{group.sequence}
                    </span>
                    <span className="font-semibold text-sm">{group.name}</span>
                    {STATUS_BADGES[group.status] ?? <Badge>{group.status}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Membros: <strong className="text-foreground">{group.memberCount}</strong>
                    </span>
                    {group.jid && <span className="font-mono text-[11px]">JID: {group.jid}</span>}
                    {group.activatedAt && (
                      <span>Ativado: {new Date(group.activatedAt).toLocaleString('pt-BR')}</span>
                    )}
                    {group.filledAt && (
                      <span>Lotado: {new Date(group.filledAt).toLocaleString('pt-BR')}</span>
                    )}
                  </div>
                  {group.lastError && (
                    <div className="text-xs text-red-400">Erro: {group.lastError}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 self-end md:self-center">
                  {canPoint(group) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={pointMutation.isPending}
                      onClick={() => setPointTarget(group)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Apontar link aqui
                    </Button>
                  )}
                  {group.inviteLink && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1.5"
                        onClick={() => copyInvite(group.inviteLink!)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar Convite
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => window.open(group.inviteLink!, '_blank')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>

      <ConfirmActionDialog
        open={!!pointTarget}
        onOpenChange={(o) => !o && setPointTarget(null)}
        title="Apontar o link para outro grupo?"
        confirmLabel="Apontar link"
        pending={pointMutation.isPending}
        onConfirm={() => pointTarget && pointMutation.mutate(pointTarget.id)}
      >
        <p>
          O link <code className="text-foreground">/g/{groupLink?.slug}</code> passará a levar para{' '}
          <strong className="text-foreground">
            #{pointTarget?.sequence} {pointTarget?.name}
          </strong>{' '}
          ({pointTarget?.memberCount}/{groupLink?.memberLimit} membros).
        </p>
        {activeGroup && (
          <p>
            O grupo atual <strong className="text-foreground">#{activeGroup.sequence}</strong>{' '}
            {activeGroup.memberCount >= rotateAt
              ? 'já atingiu a margem e será marcado como CHEIO.'
              : 'ficará em ESPERA e será reaproveitado quando este encher (nenhum grupo novo é criado).'}
          </p>
        )}
      </ConfirmActionDialog>
    </Dialog>
  );
}
