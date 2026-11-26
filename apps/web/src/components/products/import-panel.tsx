'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useApiMutation } from '@/lib/mutations';
import type { ApiProduct } from '@/lib/types';
import type { AwinLinksBatchItem, ProductsImportItem } from '@afilados/shared';
import { toast } from 'sonner';

/** Limite da rota de lote da Awin (`POST /marketplaces/awin/links/batch`). */
const AWIN_BATCH_MAX = 200;

/** URLs únicas do texto colado (uma por linha, planilha ou texto solto), na ordem. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s,;"'<>]+/gi) ?? [];
  return [...new Set(found)];
}

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

export function ImportPanel({
  onImported,
  source,
}: {
  onImported: (r: ImportResult) => void;
  /** Marketplace selecionado; na Awin aparece a conversão de links em lote. */
  source?: string;
}) {
  const [text, setText] = useState('');
  const [awinLinks, setAwinLinks] = useState<AwinLinksBatchItem[]>([]);
  const awinBatch = useApiMutation(
    (urls: string[]) =>
      apiFetch<{ items: AwinLinksBatchItem[] }>('/marketplaces/awin/links/batch', {
        method: 'POST',
        json: { items: urls.map((url) => ({ url })) },
      }),
    { onSuccess: (r) => setAwinLinks(r.items) },
  );
  const awinUrls = source === 'AWIN' ? extractUrls(text) : [];

  async function copyAwinLinks() {
    const links = awinLinks.flatMap((l) => (l.url ? [l.url] : []));
    if (links.length === 0) return;
    await copyToClipboard(links.join('\n'));
    toast.success(`${links.length} link(s) copiado(s)`);
  }
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
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="bg-brand text-white hover:bg-brand/90"
          disabled={imp.isPending || !text.trim()}
          onClick={handleImportClick}
        >
          {imp.isPending ? 'Importando…' : 'Importar produtos'}
        </Button>
        {source === 'AWIN' && (
          <Button
            variant="outline"
            disabled={awinBatch.isPending || awinUrls.length === 0 || awinUrls.length > AWIN_BATCH_MAX}
            onClick={() => awinBatch.mutate(awinUrls)}
            title="Gera os links de afiliado da Awin de todas as URLs coladas de uma vez"
          >
            {awinBatch.isPending ? 'Gerando…' : 'Gerar links Awin'}
          </Button>
        )}
        <label className="cursor-pointer text-sm text-brand underline hover:text-brand/80">
          ou enviar Planilha (.xlsx, .xls, .csv)
          <input
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            disabled={imp.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Limpa o value para permitir reenviar o mesmo arquivo CSV/planilha quantas vezes quiser
              e.target.value = '';
              if (f) {
                const fd = new FormData();
                fd.append('file', f);
                imp.mutate(fd);
              }
            }}
          />
        </label>
      </div>
      {source === 'AWIN' && awinUrls.length > AWIN_BATCH_MAX && (
        <p className="text-xs text-amber-300">
          Cole no máximo {AWIN_BATCH_MAX} links por vez para gerar os links da Awin.
        </p>
      )}
      {awinLinks.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Links da Awin ({awinLinks.filter((l) => l.url).length} de {awinLinks.length})
            </p>
            <Button size="sm" variant="secondary" onClick={() => void copyAwinLinks()}>
              Copiar todos
            </Button>
          </div>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-xs">
            {awinLinks.map((l) => (
              <li key={l.input} className="min-w-0">
                <p className="truncate text-muted-foreground" title={l.input}>
                  {l.input}
                </p>
                {l.url ? (
                  <p className="break-all text-foreground">{l.url}</p>
                ) : (
                  <p className="text-amber-300">{l.error}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
