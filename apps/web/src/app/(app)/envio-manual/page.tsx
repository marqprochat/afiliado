'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DispatchMode, DispatchResult } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { isSelectableCoupon } from '@/components/coupons/coupon-dispatch-bar';
import { apiFetch } from '@/lib/api';
import { useDispatchTarget } from '@/lib/dispatch-target';
import { useApiMutation } from '@/lib/mutations';
import { useCoupons, useTemplates } from '@/lib/queries';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function waMarkup(text: string) {
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export default function ManualSendPage() {
  const { target, update } = useDispatchTarget('manual');
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [couponTemplateId, setCouponTemplateId] = useState('');
  const { data: couponTemplates } = useTemplates('COUPON');
  const { data: coupons } = useCoupons({ includeExpired: false });

  const activeTemplate =
    couponTemplates?.find((t) => t.id === couponTemplateId) ?? couponTemplates?.[0];
  const usable = (coupons ?? []).filter(isSelectableCoupon).slice(0, 30);

  const send = useApiMutation(
    (mode: DispatchMode) =>
      apiFetch<DispatchResult>('/manual-send', {
        method: 'POST',
        json: {
          text,
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
          sessionId: target.sessionId,
          groupJids: target.groupJids,
          telegramChatIds: target.telegramChatIds,
          mode,
          intervalMin: target.intervalMin,
        },
      }),
    {
      invalidate: [['batches'], ['overview']],
      onSuccess: (res) => {
        toast.success(
          res.mode === 'now'
            ? 'Mensagem enviando agora'
            : `Mensagem na fila — sai às ${new Date(res.firstRunAt).toLocaleString('pt-BR')}`,
        );
        setText('');
        setImageUrl('');
      },
    },
  );

  const insertCoupon = useApiMutation(
    (couponId: string) =>
      apiFetch<{ text: string }>('/templates/preview', {
        method: 'POST',
        json: { body: activeTemplate!.body, kind: 'COUPON', couponId },
      }),
    {
      onSuccess: (out) => setText((prev) => (prev.trim() ? `${prev}\n\n${out.text}` : out.text)),
    },
  );

  const canSend =
    !!text.trim() && !!target.sessionId && target.groupJids.length > 0 && !send.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Envio manual</h1>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <div>
              <Label htmlFor="manual-text">Mensagem</Label>
              <Textarea
                id="manual-text"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escreva o aviso. Use *negrito*, _itálico_ e ~riscado~."
                className="text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">{text.length}/4000</p>
            </div>
            <div>
              <Label htmlFor="manual-image">Imagem (URL, opcional)</Label>
              <Input
                id="manual-image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div
              className="rounded-2xl bg-[#005c4b] p-4 text-sm text-white shadow"
              data-testid="manual-preview"
            >
              <div
                className="whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: waMarkup(text) }}
              />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Destino</h2>
            <DispatchTargetPicker value={target} onChange={update} templateKind={null} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-brand text-white hover:bg-brand/90"
                disabled={!canSend}
                onClick={() => send.mutate('now')}
              >
                Enviar agora
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canSend}
                onClick={() => send.mutate('queue')}
              >
                Colocar na fila
              </Button>
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Inserir cupom</h2>
          {(couponTemplates?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              Crie um template de cupom em Template das mensagens para inserir cupons aqui.
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="manual-coupon-template">Template do cupom</Label>
                <select
                  id="manual-coupon-template"
                  value={activeTemplate?.id ?? ''}
                  onChange={(e) => setCouponTemplateId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
                >
                  {couponTemplates?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="max-h-[420px] space-y-1 overflow-y-auto">
                {usable.length === 0 && (
                  <li className="text-xs text-muted-foreground">Nenhum cupom válido cadastrado.</li>
                )}
                {usable.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-label={`Inserir cupom ${c.code}`}
                      onClick={() => insertCoupon.mutate(c.id)}
                      className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm hover:border-brand"
                    >
                      <span className="font-mono font-bold text-primary">{c.code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{c.store}</span>
                      <div className="truncate text-xs text-muted-foreground">{c.description}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
