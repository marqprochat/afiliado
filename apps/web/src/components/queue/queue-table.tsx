'use client';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
}: {
  data: QueueResponse;
  onSelect: (ids: string[], selected: boolean) => void;
  onRemove: (id: string) => void;
  onClearSent: () => void;
}) {
  const allSelected = data.items.length > 0 && data.items.every((i) => i.selected);
  const selectedCount = data.items.filter((i) => i.selected && i.status === 'PENDING').length;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
        <b>
          Produtos salvos ({data.count}/{data.limit})
        </b>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onSelect(
              data.items.map((i) => i.id),
              !allSelected,
            )
          }
        >
          {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
        </Button>
        <span className="text-muted-foreground">{selectedCount} selecionado(s) pendente(s)</span>
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
          {data.items.map((i) => (
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
          {data.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                Fila vazia — salve produtos em “Buscar Produtos”.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
