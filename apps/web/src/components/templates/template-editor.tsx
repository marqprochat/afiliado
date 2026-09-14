'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Template } from '@/lib/types';

export const TEMPLATE_VARS = [
  '{titulo}',
  '{preco}',
  '{preco_antigo}',
  '{desconto}',
  '{vendas}',
  '{link}',
  '{cupom}',
  '{oferta_relampago}',
  '{frete}',
  '{frete_gratis}',
  '{frete_full}',
  '{cta}',
];

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function waMarkup(text: string) {
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export function TemplateEditor({
  initial,
  onSave,
  onDelete,
  preview,
  saving,
}: {
  initial?: Template;
  onSave: (t: { name: string; body: string; isDefault: boolean }) => void;
  onDelete?: () => void;
  preview: (body: string) => Promise<string>;
  saving?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? 'Novo template');
  const [body, setBody] = useState(initial?.body ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [rendered, setRendered] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!body) {
      setRendered('');
      return;
    }
    const t = setTimeout(() => {
      void preview(body)
        .then(setRendered)
        .catch(() => setRendered(''));
    }, 400);
    return () => clearTimeout(t);
  }, [body, preview]);

  function insert(v: string) {
    const el = ta.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + v + body.slice(end));
    requestAnimationFrame(() => el?.setSelectionRange(start + v.length, start + v.length));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, body, isDefault });
        }}
      >
        <div>
          <Label htmlFor="tname">Nome</Label>
          <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tbody">Corpo da mensagem</Label>
          <Textarea
            id="tbody"
            ref={ta}
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs hover:border-brand"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Blocos condicionais: {'{#cupom}…{/cupom}'} só aparecem quando a variável tem valor.
        </p>
        <div className="flex items-center gap-2">
          <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
          <Label htmlFor="isDefault">Template padrão</Label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="bg-brand text-white hover:bg-brand/90" disabled={saving}>
            Salvar
          </Button>
          {onDelete && (
            <Button type="button" variant="destructive" onClick={onDelete}>
              Excluir
            </Button>
          )}
        </div>
      </form>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Pré-visualização (produto de exemplo)</p>
        <div
          className="rounded-2xl bg-[#005c4b] p-4 text-sm text-white shadow"
          data-testid="preview"
        >
          <div
            className="whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: waMarkup(rendered) }}
          />
        </div>
      </div>
    </div>
  );
}
