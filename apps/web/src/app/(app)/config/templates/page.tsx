'use client';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TemplateEditor } from '@/components/templates/template-editor';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useCoupons, useTemplates } from '@/lib/queries';
import type { Template } from '@/lib/types';
import { cn } from '@/lib/utils';

type TemplateInput = {
  name: string;
  body: string;
  isDefault: boolean;
  kind: 'PRODUCT' | 'COUPON';
};
const INV = [['templates']];

export default function TemplatesPage() {
  const { data: templates } = useTemplates();
  const { data: coupons } = useCoupons({ includeExpired: false });
  const [selected, setSelected] = useState<string | 'new' | 'new-coupon' | null>(null);
  const creatingCoupon = selected === 'new-coupon';
  const creating = selected === 'new' || creatingCoupon;
  const current = creating
    ? undefined
    : (templates?.find((t) => t.id === selected) ?? templates?.[0]);
  const editorKind: 'PRODUCT' | 'COUPON' = creating
    ? creatingCoupon
      ? 'COUPON'
      : 'PRODUCT'
    : (current?.kind ?? 'PRODUCT');

  const create = useApiMutation(
    (t: TemplateInput) => apiFetch<Template>('/templates', { method: 'POST', json: t }),
    {
      invalidate: INV,
      success: 'Template criado',
      onSuccess: (out) => setSelected(out.id),
    },
  );
  const createExample = useApiMutation(
    () => apiFetch<Template>('/templates/coupon-example', { method: 'POST' }),
    {
      invalidate: INV,
      success: 'Template de exemplo pronto',
      onSuccess: (out) => setSelected(out.id),
    },
  );
  const update = useApiMutation(
    ({ id, t }: { id: string; t: TemplateInput }) =>
      apiFetch(`/templates/${id}`, { method: 'PUT', json: t }),
    { invalidate: INV, success: 'Template salvo' },
  );
  const remove = useApiMutation(
    (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
    {
      invalidate: INV,
      success: 'Template excluído',
      onSuccess: () => setSelected(null),
    },
  );
  const preview = useCallback(
    (body: string, couponId?: string) =>
      apiFetch<{ text: string }>('/templates/preview', {
        method: 'POST',
        json: { body, kind: editorKind, ...(couponId ? { couponId } : {}) },
      }).then((r) => r.text),
    [editorKind],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Template das mensagens</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => createExample.mutate(undefined)}
            disabled={createExample.isPending}
          >
            Criar template de exemplo de cupom
          </Button>
          <Button variant="outline" onClick={() => setSelected('new-coupon')}>
            Novo template de cupom
          </Button>
          <Button
            onClick={() => setSelected('new')}
            className="bg-brand text-white hover:bg-brand/90"
          >
            Novo template
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <ul className="space-y-1">
          {(templates ?? []).map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelected(t.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2',
                  current?.id === t.id && 'bg-brand/15 text-brand',
                )}
              >
                {t.name}
                <span className="flex gap-1">
                  {t.kind === 'COUPON' && <Badge className="bg-amber-500/20 text-amber-500">Cupom</Badge>}
                  {t.isDefault && <Badge className="bg-brand/20 text-brand">Padrão</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <TemplateEditor
          key={`${current?.id ?? selected ?? 'new'}`}
          initial={current}
          kind={editorKind}
          coupons={(coupons ?? []).map((c) => ({ id: c.id, code: c.code }))}
          preview={preview}
          saving={create.isPending || update.isPending}
          onSave={(t) => (current ? update.mutate({ id: current.id, t }) : create.mutate(t))}
          onDelete={
            current && (templates?.length ?? 0) > 1
              ? () => {
                  if (confirm('Excluir este template?')) remove.mutate(current.id);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
