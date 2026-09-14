'use client';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/lib/format';
import type { ApiProduct } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ProductCard({
  product: p,
  selected,
  onToggle,
  onCopy,
}: {
  product: ApiProduct;
  selected: boolean;
  onToggle: (id: string) => void;
  onCopy: (p: ApiProduct) => void;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border border-border bg-surface p-3',
        selected && 'border-brand',
      )}
    >
      <div className="absolute left-2 top-2 z-10">
        <NativeCheckbox
          checked={selected}
          onChange={() => onToggle(p.id)}
          aria-label="Selecionar"
        />
      </div>
      {p.discountPct ? (
        <span className="absolute right-2 top-2 z-10 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
          -{p.discountPct}%
        </span>
      ) : null}
      <div className="mb-2 aspect-square overflow-hidden rounded bg-surface-2">
        {p.images[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </div>
      <p className="mb-1 line-clamp-2 text-xs" title={p.title}>
        {p.title}
      </p>
      <p className="text-sm font-semibold">{formatBRL(p.price)}</p>
      {p.originalPrice && (
        <p className="text-xs text-muted-foreground line-through">{formatBRL(p.originalPrice)}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {p.salesCount !== null && <span>🔥 {p.salesCount} vendidos</span>}
        {p.commissionPct !== null && <span className="ml-2 text-brand">💰 {p.commissionPct}%</span>}
      </p>
      <Button size="sm" variant="secondary" className="mt-2 text-xs" onClick={() => onCopy(p)}>
        Copiar texto + link
      </Button>
    </div>
  );
}
