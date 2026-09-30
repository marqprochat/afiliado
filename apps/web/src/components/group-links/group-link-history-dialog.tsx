'use client';
import { Copy, ExternalLink, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useGroupLinkHistory } from '@/lib/queries';
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
  STANDBY: <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30">STANDBY</Badge>,
};

export function GroupLinkHistoryDialog({
  groupLink,
  open,
  onOpenChange,
}: GroupLinkHistoryDialogProps) {
  const { data: groups = [], isLoading } = useGroupLinkHistory(groupLink?.id ?? null);

  const copyInvite = (link: string) => {
    navigator.clipboard.writeText(link);
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
          • Limite por grupo: {groupLink?.memberLimit} membros
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
    </Dialog>
  );
}
