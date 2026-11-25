'use client';
import { useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatBRL } from '@/lib/format';
import type { QueueResponse } from '@/lib/types';

const STATUS_LABEL = {
  PENDING: 'Pendente',
  PENDING_ENRICH: 'Carregando dados',
  SENT: 'Enviado',
  ERROR: 'Erro',
} as const;

export function QueueTable({
  data,
  onSelect,
  onRemove,
  onClearSent,
  onSendToBatch,
}: {
  data: QueueResponse;
  onSelect: (ids: string[], selected: boolean) => void;
  onRemove: (id: string) => void;
  onClearSent: () => void;
  onSendToBatch?: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const normalizedKeyword = keyword.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    if (!normalizedKeyword) return data.items;
    return data.items.filter(
      (i) =>
        i.product.title.toLowerCase().includes(normalizedKeyword) ||
        i.product.source.toLowerCase().includes(normalizedKeyword),
    );
  }, [data.items, normalizedKeyword]);

  const pendingVisibleIds = visibleItems
    .filter((i) => i.status === 'PENDING')
    .map((i) => i.id);
  const allSelected =
    pendingVisibleIds.length > 0 &&
    visibleItems.filter((i) => i.status === 'PENDING').every((i) => i.selected);
  const selectedCount = data.items.filter((i) => i.selected && i.status === 'PENDING').length;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <b>Produtos salvos ({data.items.length})</b>
        <span
          className="text-xs text-muted-foreground"
          title="Inclui produtos que já estão em lotes"
        >
          fila {data.count}
        </span>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Filtrar por palavra-chave..."
            aria-label="Filtrar fila por palavra-chave"
            className="h-7 pl-7 pr-7 text-xs"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              aria-label="Limpar filtro"
              className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {normalizedKeyword && (
          <span className="text-xs text-muted-foreground">
            {visibleItems.length} de {data.items.length}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={pendingVisibleIds.length === 0}
          onClick={() => onSelect(pendingVisibleIds, !allSelected)}
        >
          {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
        </Button>
        <span className="text-muted-foreground">{selectedCount} selecionado(s) pendente(s)</span>
        {onSendToBatch && (
          <Button
            size="sm"
            variant="outline"
            disabled={selectedCount === 0}
            onClick={onSendToBatch}
          >
            Trazer selecionados para lote
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearSent}>
          Limpar enviados
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Produto</TableHead>
            <TableHead>Loja</TableHead>
            <TableHead className="text-right">Preço</TableHead>
            <TableHead className="text-right">Desc.</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleItems.map((i) => (
            <TableRow key={i.id} className={i.status !== 'PENDING' ? 'opacity-60' : ''}>
              <TableCell>
                <NativeCheckbox
                  checked={i.selected}
                  disabled={i.status !== 'PENDING'}
                  onChange={(e) => onSelect([i.id], e.target.checked)}
                  aria-label={`Selecionar ${i.product.title}`}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {i.product.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={i.product.images[0]}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  )}
                  <span className="line-clamp-1 max-w-xs text-sm">{i.product.title}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{i.product.source}</Badge>
              </TableCell>
              <TableCell className="text-right text-brand">{formatBRL(i.product.price)}</TableCell>
              <TableCell className="text-right">
                {i.product.discountPct ? `-${i.product.discountPct}%` : '—'}
              </TableCell>
              <TableCell>
                <StatusPill label={STATUS_LABEL[i.status]} status={i.status} />
              </TableCell>
              <TableCell>
                <button
                  onClick={() => onRemove(i.id)}
                  aria-label="Remover"
                  className="text-muted-foreground hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </TableCell>
            </TableRow>
          ))}
          {visibleItems.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {normalizedKeyword
                  ? `Nenhum produto encontrado para "${keyword.trim()}".`
                  : 'Fila vazia — salve produtos em “Buscar Produtos”.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
