'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { ApiProduct } from '@/lib/types';
import type { ProductsImportItem } from '@afilados/shared';

export type ImportResult = {
  products: ApiProduct[];
  unsupported: { url: string; reason: string }[];
};

type ImportBody =
  | { urls: string[] }
  | { items: ProductsImportItem[] }
  | { text: string }
  | FormData;

/** Aceita tanto o JSON estruturado copiado pela extensão (título/preço/imagem já lidos do
 *  card da página) quanto texto solto ou linhas de planilha — o backend faz o parse inteligente
 *  de colunas e URLs. */
function parsePastedText(text: string): {
  items?: ProductsImportItem[];
  textPayload?: string;
  droppedNoPrice: number;
} {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      Array.isArray(parsed) &&
      parsed.every((p) => p && typeof p === 'object' && typeof p.url === 'string')
    ) {
      const all = parsed as ProductsImportItem[];
      const items = all.filter(
        (p) => typeof p.price === 'number' && !isNaN(p.price) && p.price > 0,
      );
      return { items, droppedNoPrice: all.length - items.length };
    }
  } catch {
    // não é JSON — segue como texto de planilha / URLs
  }
  return { textPayload: text.trim(), droppedNoPrice: 0 };
}

export function ImportPanel({ onImported }: { onImported: (r: ImportResult) => void }) {
  const [text, setText] = useState('');
  const [unsupported, setUnsupported] = useState<ImportResult['unsupported']>([]);
  const [droppedNoPrice, setDroppedNoPrice] = useState(0);
  const imp = useApiMutation(
    (body: ImportBody) =>
      body instanceof FormData
        ? apiFetch<ImportResult>('/products/import', { method: 'POST', body })
        : apiFetch<ImportResult>('/products/import', { method: 'POST', json: body }),
    {
      onSuccess: (r) => {
        setUnsupported(r.unsupported);
        onImported(r);
      },
    },
  );

  function handleImportClick() {
    const { items, textPayload, droppedNoPrice: dropped } = parsePastedText(text);
    setDroppedNoPrice(dropped);
    if (items) {
      if (items.length === 0) return;
      imp.mutate({ items });
    } else if (textPayload) {
      imp.mutate({ text: textPayload });
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-[138px] max-h-[138px] resize-none overflow-y-auto [field-sizing:fixed]"
        style={{ fieldSizing: 'fixed' }}
        placeholder={
          'Cole uma ou mais URLs ou copie e cole as linhas da sua planilha:\n' +
          'SKU,ID ALIE,Nome do Item,Preço DE,Código Cupom,Preço c/ Cupom,Link...\n\n' +
          'Ou envie o arquivo Excel (.xlsx, .xls) ou CSV diretamente pelo botão abaixo.'
        }
      />
      <div className="flex items-center gap-3">
        <Button
          className="bg-brand text-white hover:bg-brand/90"
          disabled={imp.isPending || !text.trim()}
          onClick={handleImportClick}
        >
          {imp.isPending ? 'Importando…' : 'Importar produtos'}
        </Button>
        <label className="cursor-pointer text-sm text-brand underline hover:text-brand/80">
          ou enviar Planilha (.xlsx, .xls, .csv)
          <input
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const fd = new FormData();
                fd.append('file', f);
                imp.mutate(fd);
              }
            }}
          />
        </label>
      </div>
      {droppedNoPrice > 0 && (
        <p className="text-xs text-amber-300">
          {droppedNoPrice} produto(s) ignorado(s) por não terem preço detectado.
        </p>
      )}
      {unsupported.length > 0 && (
        <ul className="text-xs text-amber-300">
          {unsupported.map((u) => (
            <li key={u.url}>
              {u.url} — {u.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
