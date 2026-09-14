'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { ApiProduct } from '@/lib/types';

export type ImportResult = {
  products: ApiProduct[];
  unsupported: { url: string; reason: string }[];
};

export function ImportPanel({ onImported }: { onImported: (r: ImportResult) => void }) {
  const [text, setText] = useState('');
  const [unsupported, setUnsupported] = useState<ImportResult['unsupported']>([]);
  const imp = useApiMutation(
    (body: { urls: string[] } | FormData) =>
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
        placeholder={'Cole uma URL por linha\nhttps://shopee.com.br/...'}
      />
      <div className="flex items-center gap-3">
        <Button
          className="bg-brand text-white hover:bg-brand/90"
          disabled={imp.isPending || !text.trim()}
          onClick={() => imp.mutate({ urls: text.split(/\s+/).filter(Boolean) })}
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
