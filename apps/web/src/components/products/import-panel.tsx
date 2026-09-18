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

type ImportBody = { urls: string[] } | { items: ProductsImportItem[] } | FormData;

/** Aceita tanto o JSON estruturado copiado pela extensão (título/preço/imagem já lidos do
 *  card da página) quanto texto solto com URLs — o que a extensão copia quando consegue ler
 *  metadados do card vira `items`, evitando depender do backend raspar cada URL depois. */
function parsePastedText(text: string): { urls: string[] } | { items: ProductsImportItem[] } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === 'object' && typeof p.url === 'string')) {
      return { items: parsed as ProductsImportItem[] };
    }
  } catch {
    // não é JSON — segue para extração de URLs em texto livre
  }
  const urls = [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
  return { urls };
}

export function ImportPanel({ onImported }: { onImported: (r: ImportResult) => void }) {
  const [text, setText] = useState('');
  const [unsupported, setUnsupported] = useState<ImportResult['unsupported']>([]);
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

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'Cole uma ou mais URLs (uma por linha, ou use o botão 🔗 Copiar links\n' +
          'da extensão Afilados Connect numa página de busca do marketplace):\n' +
          'https://shopee.com.br/...\n' +
          'https://produto.mercadolivre.com.br/MLB-...\n' +
          'https://www.amazon.com.br/dp/...\n' +
          'https://www.magazineluiza.com.br/p/...'
        }
      />
      <div className="flex items-center gap-3">
        <Button
          className="bg-brand text-white hover:bg-brand/90"
          disabled={imp.isPending || !text.trim()}
          onClick={() => imp.mutate(parsePastedText(text))}
        >
          Importar links
        </Button>
        <label className="cursor-pointer text-sm text-brand underline">
          ou enviar CSV (coluna <code>url</code>)
          <input
            type="file"
            accept=".csv,text/csv"
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
