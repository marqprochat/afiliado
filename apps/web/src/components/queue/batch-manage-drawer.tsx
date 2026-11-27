'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  ExternalLink,
  Eye,
  GripVertical,
  RotateCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { StatusPill } from '@/components/app-shell/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { SendToBatchDialog } from '@/components/queue/send-to-batch-dialog';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import {
  useBatch,
  useBatches,
  useGroups,
  useQueue,
  useTelegramAllChats,
  useTemplates,
} from '@/lib/queries';
import type { BatchDetail, BatchItem } from '@/lib/types';
import { useShareToBatches } from '@/lib/use-share-to-batches';
import { cn } from '@/lib/utils';

const INV = [['batches'], ['overview']];
const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

export const BATCH_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Agendado',
  RUNNING: 'Enviando',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
  CANCELLED: 'Cancelado',
};
const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  ERROR: 'Erro',
};

export function BatchManageDrawer({
  batchId,
  onClose,
}: {
  batchId: string | null;
  onClose: () => void;
}) {
  const { data: batch } = useBatch(batchId);
  const pause = useApiMutation(() => apiFetch(`/batches/${batchId}/pause`, { method: 'POST' }), {
    invalidate: INV,
    success: 'Lote pausado — já pode editar',
  });
  const resume = useApiMutation(() => apiFetch(`/batches/${batchId}/resume`, { method: 'POST' }), {
    invalidate: INV,
    success: 'Lote retomado e reagendado',
  });
  const editable = batch?.status === 'PAUSED';
  const canPause = batch?.status === 'SCHEDULED' || batch?.status === 'RUNNING';

  const { data: allBatches } = useBatches();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<BatchItem | null>(null);
  useEffect(() => {
    setSelected(new Set());
    setShareOpen(false);
    setPreviewItem(null);
  }, [batchId]);
  // só vale o que ainda existe no lote
  const selectedIds = useMemo(() => {
    const inBatch = new Set((batch?.items ?? []).map((i) => i.id));
    return [...selected].filter((id) => inBatch.has(id));
  }, [batch?.items, selected]);
  const shareIds = useMemo(() => {
    const byId = new Map((batch?.items ?? []).map((i) => [i.id, i]));
    const ids = selectedIds
      .map((id) => byId.get(id)?.productId)
      .filter((p): p is string => !!p);
    return [...new Set(ids)];
  }, [batch?.items, selectedIds]);
  const share = useShareToBatches(allBatches ?? [], () => {
    setShareOpen(false);
    setSelected(new Set());
  });

  return (
    <>
      <Drawer open={!!batchId} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="max-w-2xl">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              {batch?.name ?? 'Lote'}
              {batch && (
                <StatusPill
                  label={BATCH_STATUS_LABEL[batch.status] ?? batch.status}
                  status={batch.status}
                />
              )}
            </DrawerTitle>
            <DrawerDescription>
              {editable
                ? 'Lote pausado: edite à vontade e clique em Retomar para reagendar os envios.'
                : canPause
                  ? 'Para editar, pause o lote. Envios agendados ficam suspensos até você retomar. Para compartilhar ofertas com outros lotes não precisa pausar.'
                  : 'Lote finalizado: edição indisponível (você ainda pode compartilhar ofertas com outros lotes).'}
            </DrawerDescription>
            {canPause && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 w-fit"
                disabled={pause.isPending}
                onClick={() => pause.mutate(undefined)}
              >
                Pausar para editar
              </Button>
            )}
          </DrawerHeader>

          {!batch ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <ItemsSection
                key={`items-${itemsSignature(batch)}`}
                batch={batch}
                editable={editable}
                selectedIds={selectedIds}
                setSelected={setSelected}
                shareCount={shareIds.length}
                onShare={() => setShareOpen(true)}
                onPreview={setPreviewItem}
              />
              {editable && <AddProductsSection batch={batch} />}
              <ConfigSection
                key={`cfg-${batch.status}-${batch.name}-${batch.templateId}-${batch.intervalMin}-${batch.mediaMode}`}
                batch={batch}
                editable={editable}
              />
            </>
          )}

          {editable && (
            <DrawerFooter>
              <Button
                className="bg-brand text-white hover:bg-brand/90"
                disabled={resume.isPending}
                onClick={() => resume.mutate(undefined)}
              >
                Retomar envios
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
      <SendToBatchDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        batches={allBatches ?? []}
        excludeBatchIds={batchId ? [batchId] : []}
        count={shareIds.length}
        submitting={share.isPending}
        onConfirm={({ batchIds, position }) =>
          share.mutate({ productIds: shareIds, batchIds, position })
        }
      />
      {batchId && (
        <ItemPreviewDialog
          batchId={batchId}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </>
  );
}

/** Primeiros 60 caracteres da mensagem livre (texto puro; o React escapa na renderização). */
function customTextPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

function itemsSignature(b: BatchDetail) {
  return b.items.map((i) => `${i.id}:${i.order}:${i.status}`).join('|');
}

function ItemsSection({
  batch,
  editable,
  selectedIds,
  setSelected,
  shareCount,
  onShare,
  onPreview,
}: {
  batch: BatchDetail;
  editable: boolean;
  selectedIds: string[];
  setSelected: (next: Set<string>) => void;
  shareCount: number;
  onShare: () => void;
  onPreview: (item: BatchItem) => void;
}) {
  const done = useMemo(() => batch.items.filter((i) => i.status !== 'PENDING'), [batch.items]);
  const initialPending = useMemo(
    () => batch.items.filter((i) => i.status === 'PENDING'),
    [batch.items],
  );
  const [pending, setPending] = useState<BatchItem[]>(initialPending);
  const dirty = pending.some((it, idx) => it.id !== initialPending[idx]?.id);

  const saveOrder = useApiMutation(
    () =>
      apiFetch(`/batches/${batch.id}/order`, {
        method: 'PUT',
        json: { itemIds: pending.map((i) => i.id) },
      }),
    { invalidate: INV, success: 'Ordem salva' },
  );
  const removeItem = useApiMutation(
    (itemId: string) => apiFetch(`/batches/${batch.id}/items/${itemId}`, { method: 'DELETE' }),
    { invalidate: INV, success: 'Item removido do lote' },
  );

  const retryOne = useApiMutation(
    (itemId: string) => apiFetch(`/batches/${batch.id}/items/${itemId}/retry`, { method: 'POST' }),
    { invalidate: [...INV, ['queue']], success: 'Item reenfileirado' },
  );
  const retryAll = useApiMutation(
    () => apiFetch(`/batches/${batch.id}/retry`, { method: 'POST' }),
    { invalidate: [...INV, ['queue']], success: 'Itens com erro reenfileirados' },
  );
  const clearSent = useApiMutation(
    () => apiFetch(`/batches/${batch.id}/items?status=SENT`, { method: 'DELETE' }),
    { invalidate: [...INV, ['queue']], success: 'Enviados removidos do lote' },
  );
  const removeMany = useApiMutation(
    (itemIds: string[]) =>
      apiFetch<{ removed: number; skipped: number }>(`/batches/${batch.id}/items/remove`, {
        method: 'POST',
        json: { itemIds },
      }),
    {
      invalidate: [...INV, ['queue']],
      onSuccess: (r) => {
        setSelected(new Set());
        if (r.skipped > 0) {
          toast.warning(
            `${r.removed} removido(s). ${r.skipped} ficaram: pendentes só saem com o lote pausado e "enviando" nunca.`,
          );
        } else toast.success(`${r.removed} item(ns) removido(s) do lote`);
      },
    },
  );
  const selectedSet = new Set(selectedIds);
  const allIds = batch.items.map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const removeSelected = () => {
    const runningPending = !editable
      ? batch.items.filter((i) => selectedSet.has(i.id) && i.status === 'PENDING').length
      : 0;
    const msg =
      `Remover ${selectedIds.length} item(ns) do lote?` +
      (runningPending > 0
        ? `\n\n${runningPending} pendente(s) só saem com o lote pausado e vão ficar.`
        : '');
    if (window.confirm(msg)) removeMany.mutate(selectedIds);
  };
  const errorCount = done.filter((i) => i.status === 'ERROR').length;
  const sentCount = done.filter((i) => i.status === 'SENT').length;
  const canRetry = batch.status !== 'CANCELLED';

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  /** Tira o item de `from` e o reinsere em `to` (índices entre os pendentes). */
  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= pending.length || to >= pending.length) return;
    const next = [...pending];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setPending(next);
  };
  const move = (idx: number, dir: -1 | 1) => moveTo(idx, idx + dir);
  const endDrag = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const shareProps = (it: BatchItem) => ({
    checked: selectedSet.has(it.id),
    onChange: () => toggle(it.id),
    label: `Selecionar ${it.product?.title ?? (it.coupon ? `cupom ${it.coupon.code}` : `item ${it.order + 1}`)}`,
  });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Fila do lote ({batch.items.length})</h3>
        <Button size="sm" variant="secondary" disabled={shareCount === 0} onClick={onShare}>
          <Share2 className="size-3.5" />
          Compartilhar selecionados ({shareCount})
        </Button>
        {canRetry && errorCount > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={retryAll.isPending}
            onClick={() => retryAll.mutate(undefined)}
          >
            <RotateCw className="size-3.5" />
            Tentar novamente todos ({errorCount})
          </Button>
        )}
        {sentCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={clearSent.isPending || dirty}
            title={dirty ? 'Salve a nova ordem antes de limpar os enviados' : undefined}
            onClick={() => clearSent.mutate(undefined)}
          >
            <Trash2 className="size-3.5" />
            Limpar enviados ({sentCount})
          </Button>
        )}
        {editable && dirty && (
          <Button
            size="sm"
            className={cn('bg-brand text-white hover:bg-brand/90', sentCount === 0 && 'ml-auto')}
            disabled={saveOrder.isPending}
            onClick={() => saveOrder.mutate(undefined)}
          >
            Salvar ordem
          </Button>
        )}
      </div>
      {batch.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs">
          <label className="flex cursor-pointer items-center gap-1.5">
            <NativeCheckbox
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
              aria-label="Selecionar todos"
            />
            Selecionar todos
          </label>
          {errorCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelected(
                  new Set(batch.items.filter((i) => i.status === 'ERROR').map((i) => i.id)),
                )
              }
            >
              Selecionar com erro ({errorCount})
            </Button>
          )}
          {selectedIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            disabled={selectedIds.length === 0 || removeMany.isPending || dirty}
            title={dirty ? 'Salve a nova ordem antes de remover itens' : undefined}
            onClick={removeSelected}
          >
            <Trash2 className="size-3.5" />
            Remover selecionados ({selectedIds.length})
          </Button>
        </div>
      )}
      {batch.items.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum item neste lote.</p>
      )}
      <ol className="space-y-1.5">
        {done.map((it, idx) => (
          <ItemRow
            key={it.id}
            item={it}
            position={idx + 1}
            select={shareProps(it)}
            onPreview={() => onPreview(it)}
          >
            {canRetry && it.status === 'ERROR' && (
              <IconBtn
                label="Tentar novamente"
                onClick={() => retryOne.mutate(it.id)}
                disabled={retryOne.isPending}
              >
                <RotateCw className="size-3.5" />
              </IconBtn>
            )}
            {it.status !== 'SENDING' && (
              <IconBtn
                label="Remover"
                onClick={() => removeMany.mutate([it.id])}
                disabled={removeMany.isPending}
                danger
              >
                <Trash2 className="size-3.5" />
              </IconBtn>
            )}
          </ItemRow>
        ))}
        {pending.map((it, idx) => (
          <ItemRow
            key={it.id}
            item={it}
            position={done.length + idx + 1}
            select={shareProps(it)}
            onPreview={() => onPreview(it)}
            hideRunAt={editable}
            drag={
              editable
                ? {
                    dragging: dragIdx === idx,
                    over: overIdx === idx && dragIdx !== null && dragIdx !== idx,
                    onDragStart: () => setDragIdx(idx),
                    onDragOver: () => setOverIdx(idx),
                    onDrop: () => {
                      if (dragIdx !== null) moveTo(dragIdx, idx);
                      endDrag();
                    },
                    onDragEnd: endDrag,
                  }
                : undefined
            }
          >
            {editable && (
              <>
                <IconBtn
                  label="Enviar a seguir (próximo envio)"
                  onClick={() => moveTo(idx, 0)}
                  disabled={idx === 0}
                >
                  <ChevronsUp className="size-3.5" />
                </IconBtn>
                <IconBtn label="Subir" onClick={() => move(idx, -1)} disabled={idx === 0}>
                  <ArrowUp className="size-3.5" />
                </IconBtn>
                <IconBtn
                  label="Descer"
                  onClick={() => move(idx, 1)}
                  disabled={idx === pending.length - 1}
                >
                  <ArrowDown className="size-3.5" />
                </IconBtn>
                <IconBtn
                  label="Remover"
                  onClick={() => removeItem.mutate(it.id)}
                  disabled={dirty}
                  danger
                >
                  <Trash2 className="size-3.5" />
                </IconBtn>
              </>
            )}
          </ItemRow>
        ))}
      </ol>
      {editable && pending.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {dirty
            ? 'Salve a nova ordem antes de remover itens.'
            : 'Os horários dos pendentes são recalculados nessa ordem quando você retomar o lote.'}
        </p>
      )}
    </section>
  );
}

function ItemRow({
  item,
  position,
  hideRunAt,
  drag,
  select,
  onPreview,
  children,
}: {
  item: BatchItem;
  position: number;
  onPreview?: () => void;
  hideRunAt?: boolean;
  drag?: {
    dragging: boolean;
    over: boolean;
    onDragStart: () => void;
    onDragOver: () => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
  select?: { checked: boolean; onChange: () => void; label: string };
  children?: React.ReactNode;
}) {
  // Texto próprio (extensão/manual) é o que vai para o grupo: mostra ele, não o produto vinculado.
  const title = item.customText
    ? `Mensagem: ${customTextPreview(item.customText)}`
    : (item.product?.title ?? (item.coupon ? `Cupom ${item.coupon.code}` : 'Item removido'));
  const img = item.product?.images[0];
  const sent = item.sendLogs.filter((l) => l.status === 'SENT').length;
  const failed = item.sendLogs.length - sent;
  return (
    <li
      draggable={!!drag}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move';
              // Firefox só inicia o arrasto se houver algum dado no dataTransfer.
              e.dataTransfer.setData('text/plain', item.id);
              drag.onDragStart();
            }
          : undefined
      }
      onDragOver={
        drag
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              drag.onDragOver();
            }
          : undefined
      }
      onDrop={
        drag
          ? (e) => {
              e.preventDefault();
              drag.onDrop();
            }
          : undefined
      }
      onDragEnd={drag?.onDragEnd}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-surface p-2',
        drag && 'cursor-grab active:cursor-grabbing',
        drag?.dragging && 'opacity-40',
        drag?.over && 'border-brand ring-1 ring-brand',
      )}
    >
      {drag && <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      {select && (
        <NativeCheckbox
          checked={select.checked}
          onChange={select.onChange}
          aria-label={select.label}
        />
      )}
      <span className="w-6 text-center text-xs text-muted-foreground">{position}</span>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="size-10 shrink-0 rounded object-cover" />
      ) : (
        <div className="size-10 shrink-0 rounded bg-surface-2" />
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onPreview}
          disabled={!onPreview}
          className="line-clamp-1 block w-full text-left text-sm hover:text-brand hover:underline"
          title="Ver a mensagem que será enviada"
        >
          {title}
        </button>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <StatusPill label={ITEM_STATUS_LABEL[item.status] ?? item.status} status={item.status} />
          {item.status === 'PENDING' && !hideRunAt && (
            <span>previsto {formatDateTime(item.runAt)}</span>
          )}
          {item.sendLogs.length > 0 && (
            <span>
              · {sent} grupo(s) enviado(s)
              {failed > 0 ? `, ${failed} com erro` : ''}
            </span>
          )}
        </div>
        {item.error && <p className="line-clamp-2 text-[11px] text-destructive">{item.error}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {onPreview && (
          <IconBtn label="Ver mensagem" onClick={onPreview}>
            <Eye className="size-3.5" />
          </IconBtn>
        )}
        {children}
      </div>
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(danger && 'text-destructive hover:text-destructive')}
    >
      {children}
    </Button>
  );
}

function AddProductsSection({ batch }: { batch: BatchDetail }) {
  const { data: queue } = useQueue();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const inBatch = useMemo(
    () => new Set(batch.items.map((i) => i.productId).filter(Boolean)),
    [batch.items],
  );
  const options = (queue?.items ?? []).filter(
    (q) => q.status === 'PENDING' && !inBatch.has(q.productId),
  );
  const add = useApiMutation(
    () =>
      apiFetch<{ added: number; skipped: number }>(`/batches/${batch.id}/items`, {
        method: 'POST',
        json: { productIds: [...picked] },
      }),
    {
      invalidate: INV,
      onSuccess: () => setPicked(new Set()),
      success: 'Produtos incluídos no fim do lote',
    },
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Incluir produtos da fila</h3>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={picked.size === 0 || add.isPending}
          onClick={() => add.mutate(undefined)}
        >
          Incluir{picked.size > 0 ? ` (${picked.size})` : ''}
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum produto disponível na fila de envio que já não esteja neste lote.
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {options.map((q) => (
            <label key={q.id} className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={picked.has(q.productId)}
                onChange={(e) => {
                  const s = new Set(picked);
                  if (e.target.checked) s.add(q.productId);
                  else s.delete(q.productId);
                  setPicked(s);
                }}
                aria-label={q.product.title}
              />
              <span className="line-clamp-1">{q.product.title}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function ConfigSection({ batch, editable }: { batch: BatchDetail; editable: boolean }) {
  const { data: groups } = useGroups(batch.sessionId);
  const { data: templates } = useTemplates();
  const { data: telegramChats } = useTelegramAllChats();
  const [name, setName] = useState(batch.name);
  const [templateId, setTemplateId] = useState(batch.templateId);
  const [jids, setJids] = useState(() => new Set(batch.groupJids));
  const [chats, setChats] = useState(() => new Set(batch.telegramChatIds));
  const [intervalMin, setIntervalMin] = useState(batch.intervalMin);
  const [mediaMode, setMediaMode] = useState(batch.mediaMode);

  const save = useApiMutation(
    () =>
      apiFetch(`/batches/${batch.id}`, {
        method: 'PATCH',
        json: {
          name: name.trim(),
          templateId,
          groupJids: [...jids],
          telegramChatIds: [...chats],
          intervalMin,
          mediaMode,
        },
      }),
    { invalidate: INV, success: 'Configuração do lote salva' },
  );
  const groupOptions = (groups ?? []).filter((g) => g.botIsAdmin || jids.has(g.jid));
  const valid = !!name.trim() && jids.size > 0 && intervalMin >= 1 && intervalMin <= 1440;

  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Configuração</h3>
      <fieldset disabled={!editable} className="space-y-3 disabled:opacity-60">
        <div>
          <Label htmlFor="mb-name">Nome do lote</Label>
          <Input id="mb-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mb-template">Template</Label>
          <select
            id="mb-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className={selectCls}
          >
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Grupos ({jids.size})</Label>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {groupOptions.map((g) => (
              <label key={g.jid} className="flex items-center gap-2 text-sm">
                <NativeCheckbox
                  checked={jids.has(g.jid)}
                  onChange={(e) => {
                    const s = new Set(jids);
                    if (e.target.checked) s.add(g.jid);
                    else s.delete(g.jid);
                    setJids(s);
                  }}
                  aria-label={g.name}
                />
                {g.name}
              </label>
            ))}
          </div>
        </div>
        {(telegramChats?.length ?? 0) > 0 && (
          <div>
            <Label>Chats do Telegram ({chats.size})</Label>
            <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {telegramChats?.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <NativeCheckbox
                    checked={chats.has(c.chatId)}
                    onChange={(e) => {
                      const s = new Set(chats);
                      if (e.target.checked) s.add(c.chatId);
                      else s.delete(c.chatId);
                      setChats(s);
                    }}
                    aria-label={c.title}
                  />
                  {c.title}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mb-interval">Intervalo (min)</Label>
            <Input
              id="mb-interval"
              type="number"
              min={1}
              max={1440}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Formato de mídia</Label>
            <div className="mt-1 flex rounded-md border border-border p-0.5 text-sm">
              {(['IMAGE', 'PREVIEW'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMediaMode(m)}
                  className={cn(
                    'flex-1 rounded px-2 py-1',
                    mediaMode === m && 'bg-brand text-white',
                  )}
                >
                  {m === 'IMAGE' ? 'Imagem' : 'Preview'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {editable && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Salvar configuração
          </Button>
        )}
      </fieldset>
    </section>
  );
}

interface ItemPreview {
  kind: 'custom' | 'coupon' | 'product';
  text: string;
  imageUrl: string | null;
  hasUploadedImage: boolean;
  productUrl: string | null;
  note: string | null;
}

/** Mostra exatamente o texto (e a imagem) que esse item vai mandar para os grupos. */
function ItemPreviewDialog({
  batchId,
  item,
  onClose,
}: {
  batchId: string;
  item: BatchItem | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['batches', batchId, 'preview', item?.id],
    enabled: !!item,
    queryFn: () => apiFetch<ItemPreview>(`/batches/${batchId}/items/${item!.id}/preview`),
  });
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prévia do envio</DialogTitle>
          <DialogDescription>
            {item?.product?.title ?? (item?.coupon ? `Cupom ${item.coupon.code}` : 'Mensagem')}
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {error && <p className="text-sm text-destructive">Não foi possível montar a prévia.</p>}
        {data && (
          <div className="space-y-3">
            {data.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.imageUrl} alt="" className="max-h-56 w-full rounded-md object-contain" />
            )}
            {data.hasUploadedImage && (
              <p className="text-xs text-muted-foreground">Vai com a imagem enviada por você.</p>
            )}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-sans text-sm">
              {data.text}
            </pre>
            {data.note && <p className="text-[11px] text-muted-foreground">{data.note}</p>}
            {data.productUrl && (
              <a
                href={data.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Abrir a oferta na loja
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
