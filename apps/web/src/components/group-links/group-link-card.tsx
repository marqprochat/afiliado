'use client';
import { useState } from 'react';
import {
  Copy,
  ExternalLink,
  RotateCw,
  RefreshCw,
  History,
  Edit2,
  Trash2,
  Pause,
  Play,
  AlertTriangle,
  Users,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GroupLinkHistoryDialog } from './group-link-history-dialog';
import { GroupLinkFormDialog } from './group-link-form-dialog';
import { useApiMutation } from '@/lib/mutations';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import type { GroupLink } from '@/lib/types';

interface GroupLinkCardProps {
  link: GroupLink;
}

export function GroupLinkCard({ link }: GroupLinkCardProps) {
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const activeGroup = link.groups?.[0] ?? null;
  const currentMembers = activeGroup?.memberCount ?? 0;
  const memberLimit = link.memberLimit;
  const rotateAt = Math.max(1, memberLimit - link.rotateMargin);
  const percentFilled = Math.min(100, Math.round((currentMembers / memberLimit) * 100));

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${origin}/g/${link.slug}`;

  const copyLink = async () => {
    await copyToClipboard(publicUrl);
    setCopied(true);
    toast.success('Link público copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const rotateMutation = useApiMutation(
    () =>
      apiFetch(`/group-links/${link.id}/rotate`, {
        method: 'POST',
        json: { reason: 'manual' },
      }),
    {
      invalidate: [['group-links']],
      success: 'Rotação enfileirada com sucesso! O novo grupo será criado em instantes.',
    },
  );

  const reconcileMutation = useApiMutation(
    () =>
      apiFetch(`/group-links/${link.id}/reconcile`, {
        method: 'POST',
      }),
    {
      invalidate: [['group-links']],
      success: 'Reconciliação solicitada!',
    },
  );

  const toggleStatusMutation = useApiMutation(
    () =>
      apiFetch(`/group-links/${link.id}`, {
        method: 'PATCH',
        json: {
          status: link.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
        },
      }),
    {
      invalidate: [['group-links']],
      success: `Link ${link.status === 'ACTIVE' ? 'pausado' : 'ativado'} com sucesso!`,
    },
  );

  const deleteMutation = useApiMutation(
    () =>
      apiFetch(`/group-links/${link.id}`, {
        method: 'DELETE',
      }),
    {
      invalidate: [['group-links']],
      success: 'Link fixo excluído com sucesso!',
    },
  );

  const handleDelete = () => {
    if (confirm(`Tem certeza que deseja excluir o link fixo "${link.label}"?`)) {
      deleteMutation.mutate(undefined);
    }
  };

  return (
    <>
      <div className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm transition-all hover:border-border/80">
        {/* Header com Rótulo e Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="bg-brand/10 text-brand border-brand/30 text-xs font-bold">
                #{(link.displayOrder ?? 0) + 1} na Landpage
              </Badge>
              <h3 className="font-bold text-base text-foreground">{link.label}</h3>
              {link.status === 'ACTIVE' && (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  ATIVO
                </Badge>
              )}
              {link.status === 'PAUSED' && (
                <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                  PAUSADO
                </Badge>
              )}
              {link.status === 'ERROR' && (
                <Badge className="bg-red-500/15 text-red-400 border-red-500/30">ERRO</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>
                Sessão:{' '}
                <strong className="text-foreground">{link.session?.label ?? 'Sessão'}</strong>
              </span>
              <span>•</span>
              <span>
                Cliques: <strong className="text-foreground">{link.clickCount}</strong>
              </span>
              <span>•</span>
              <span>
                Total de grupos:{' '}
                <strong className="text-foreground">{link._count?.groups ?? 0}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => setShowHistory(true)}
            >
              <History className="h-3.5 w-3.5" />
              Histórico
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowEdit(true)}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Link Público com Botão Copiar */}
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
          <div className="flex-1 truncate font-mono text-xs text-foreground select-all">
            {publicUrl}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs gap-1.5 shrink-0"
            onClick={copyLink}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => window.open(`/g/${link.slug}`, '_blank')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Grupo Ativo Atual */}
        <div className="mt-4 rounded-lg border border-border/80 bg-surface-2/60 p-3.5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-brand" />
              Grupo Ativo Atual
            </span>
            {activeGroup && (
              <span className="text-muted-foreground">
                Sequência: <strong className="text-foreground">#{activeGroup.sequence}</strong>
              </span>
            )}
          </div>

          {activeGroup ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm text-foreground truncate">
                  {activeGroup.name}
                </div>
                <div className="text-xs font-semibold">
                  {currentMembers} / {memberLimit} membros
                </div>
              </div>

              {/* Barra de Progresso com marcador de rotação */}
              <div className="space-y-1">
                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full transition-all duration-300 ${
                      currentMembers >= rotateAt
                        ? 'bg-amber-500'
                        : percentFilled > 75
                          ? 'bg-brand'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${percentFilled}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>Margem de troca: {rotateAt} membros</span>
                  <span>{memberLimit}</span>
                </div>
              </div>

              {activeGroup.inviteLink && (
                <div className="text-xs text-muted-foreground truncate">
                  Convite:{' '}
                  <a
                    href={activeGroup.inviteLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline font-mono text-[11px]"
                  >
                    {activeGroup.inviteLink}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2 text-center">
              Nenhum grupo ativo no momento. Aguardando processamento inicial.
            </div>
          )}
        </div>

        {/* Mensagem de Erro (se houver) */}
        {link.lastError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Último Erro:</strong> {link.lastError}
            </div>
          </div>
        )}

        {/* Rodapé com Ações Rápidas */}
        <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {link.lastRotatedAt
              ? `Última rotação: ${new Date(link.lastRotatedAt).toLocaleString('pt-BR')}`
              : 'Nenhuma rotação realizada'}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={reconcileMutation.isPending}
              onClick={() => reconcileMutation.mutate(undefined)}
            >
              <RefreshCw
                className={`h-3 w-3 ${reconcileMutation.isPending ? 'animate-spin' : ''}`}
              />
              Reconciliar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate(undefined)}
            >
              <RotateCw className={`h-3 w-3 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
              Forçar Rotação
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={toggleStatusMutation.isPending}
              onClick={() => toggleStatusMutation.mutate(undefined)}
            >
              {link.status === 'ACTIVE' ? (
                <>
                  <Pause className="h-3 w-3" /> Pausar
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" /> Retomar
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <GroupLinkHistoryDialog groupLink={link} open={showHistory} onOpenChange={setShowHistory} />

      <GroupLinkFormDialog open={showEdit} onOpenChange={setShowEdit} editItem={link} />
    </>
  );
}
