'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { StatusPill } from '@/components/app-shell/status-pill';
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
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import {
  useBatch,
  useGroups,
  useQueue,
  useTelegramAllChats,
  useTemplates,
} from '@/lib/queries';
import type { BatchDetail, BatchItem } from '@/lib/types';
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

  return (
    <Drawer open={!!batchId} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            {batch?.name ?? 'Lote'}
            {batch && (
              <StatusPill label={BATCH_STATUS_LABEL[batch.status] ?? batch.status} status={batch.status} />
            )}
          </DrawerTitle>
          <DrawerDescription>
            {editable
              ? 'Lote pausado: edite à vontade e clique em Retomar para reagendar os envios.'
              : canPause
                ? 'Para editar, pause o lote. Envios agendados ficam suspensos até você retomar.'
                : 'Lote finalizado: apenas visualização.'}
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
            <ItemsSection key={`items-${itemsSignature(batch)}`} batch={batch} editable={editable} />
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
  );
}

function itemsSignature(b: BatchDetail) {
  return b.items.map((i) => `${i.id}:${i.order}:${i.status}`).join('|');
}

function ItemsSection({ batch, editable }: { batch: BatchDetail; editable: boolean }) {
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

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= pending.length) return;
    const next = [...pending];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setPending(next);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Fila do lote ({batch.items.length})</h3>
        {editable && dirty && (
          <Button
            size="sm"
            className="ml-auto bg-brand text-white hover:bg-brand/90"
            disabled={saveOrder.isPending}
            onClick={() => saveOrder.mutate(undefined)}
          >
            Salvar ordem
          </Button>
        )}
      </div>
      {batch.items.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum item neste lote.</p>
      )}
      <ol className="space-y-1.5">
        {done.map((it, idx) => (
          <ItemRow key={it.id} item={it} position={idx + 1}>
            {editable && it.status === 'ERROR' && (
              <IconBtn label="Remover" onClick={() => removeItem.mutate(it.id)} danger>
                <Trash2 className="size-3.5" />
              </IconBtn>
            )}
          </ItemRow>
        ))}
        {pending.map((it, idx) => (
          <ItemRow key={it.id} item={it} position={done.length + idx + 1} hideRunAt={editable}>
            {editable && (
              <>
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
  children,
}: {
  item: BatchItem;
  position: number;
  hideRunAt?: boolean;
  children?: React.ReactNode;
}) {
  const title = item.product?.title ?? (item.coupon ? `Cupom ${item.coupon.code}` : 'Item removido');
  const img = item.product?.images[0];
  const sent = item.sendLogs.filter((l) => l.status === 'SENT').length;
  const failed = item.sendLogs.length - sent;
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-surface p-2">
      <span className="w-6 text-center text-xs text-muted-foreground">{position}</span>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="size-10 shrink-0 rounded object-cover" />
      ) : (
        <div className="size-10 shrink-0 rounded bg-surface-2" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm">{title}</p>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <StatusPill label={ITEM_STATUS_LABEL[item.status] ?? item.status} status={item.status} />
          {item.status === 'PENDING' && !hideRunAt && <span>previsto {formatDateTime(item.runAt)}</span>}
          {item.sendLogs.length > 0 && (
            <span>
              · {sent} grupo(s) enviado(s)
              {failed > 0 ? `, ${failed} com erro` : ''}
            </span>
          )}
        </div>
        {item.error && <p className="line-clamp-2 text-[11px] text-destructive">{item.error}</p>}
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
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
                  className={cn('flex-1 rounded px-2 py-1', mediaMode === m && 'bg-brand text-white')}
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
