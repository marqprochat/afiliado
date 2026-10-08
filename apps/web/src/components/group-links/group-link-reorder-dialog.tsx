'use client';

import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ListOrdered, Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { GroupLink } from '@/lib/types';

interface GroupLinkReorderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: GroupLink[];
}

export function GroupLinkReorderDialog({
  open,
  onOpenChange,
  links: initialLinks,
}: GroupLinkReorderDialogProps) {
  const [items, setItems] = useState<GroupLink[]>([]);

  useEffect(() => {
    if (open) {
      // Ordena pelos itens existentes
      const sorted = [...initialLinks].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      setItems(sorted);
    }
  }, [open, initialLinks]);

  const reorderMutation = useApiMutation(
    (orderedIds: string[]) =>
      apiFetch('/group-links/reorder', {
        method: 'PATCH',
        json: { orderedIds },
      }),
    {
      invalidate: [['group-links']],
      success: 'Ordem da Landing Page atualizada com sucesso!',
      onSuccess: () => {
        onOpenChange(false);
      },
    },
  );

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const newItems = [...items];
    const [movedItem] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, movedItem);
    setItems(newItems);
  };

  const handleSave = () => {
    const orderedIds = items.map((i) => i.id);
    reorderMutation.mutate(orderedIds);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-brand" />
            Organizar Ordem dos Grupos na Landing Page
          </DialogTitle>
          <DialogDescription>
            Defina quais grupos aparecem primeiro na página pública. O grupo no topo (#1) será o
            primeiro botão visível para os visitantes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 py-3 pr-1">
          {items.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhum link cadastrado para organizar.
            </div>
          ) : (
            items.map((link, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === items.length - 1;

              return (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface-2 hover:bg-surface-3 transition-colors gap-3"
                >
                  {/* Posicao e Identidade */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Badge
                      variant="outline"
                      className={`h-7 w-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        idx === 0
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-surface text-muted-foreground'
                      }`}
                    >
                      #{idx + 1}
                    </Badge>

                    {/* Foto Pequena / Avatar */}
                    {link.groupImageBase64 ? (
                      <img
                        src={link.groupImageBase64}
                        alt={link.label}
                        className="w-9 h-9 rounded-lg object-cover shrink-0 border border-border"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 border border-emerald-500/20">
                        {link.label.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-foreground truncate flex items-center gap-2">
                        <span>{link.label}</span>
                        {link.status !== 'ACTIVE' && (
                          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                            Pausado
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        /g/{link.slug} · {link.baseName}
                      </div>
                    </div>
                  </div>

                  {/* Botoes de Subir / Descer */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={isFirst || reorderMutation.isPending}
                      onClick={() => moveItem(idx, 'up')}
                      title="Mover para cima"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={isLast || reorderMutation.isPending}
                      onClick={() => moveItem(idx, 'down')}
                      title="Mover para baixo"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="border-t border-border pt-3 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={reorderMutation.isPending || items.length === 0}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {reorderMutation.isPending ? 'Salvando...' : 'Salvar Ordem da Landing Page'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
