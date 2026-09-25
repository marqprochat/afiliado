'use client';
import { toast } from 'sonner';
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
  const pending = Boolean(p.raw?.pendingEnrich);
  // Único jeito confiável de descobrir um ID de categoria válido para a busca por categoria da
  // Shopee: o ID que aparece na URL do site (shopee.com.br/...-cat.NNNNNNNN) é de um namespace
  // diferente do usado pela Open Platform e sempre retorna 0 resultados (testado ao vivo).
  const shopeeCatId = p.source === 'SHOPEE' ? p.raw?.productCatIds?.[0] : undefined;
  async function copyCatId() {
    if (!shopeeCatId) return;
    await navigator.clipboard.writeText(String(shopeeCatId));
    toast.success(`ID de categoria ${shopeeCatId} copiado`);
  }
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border border-border bg-surface p-3',
        selected && 'border-brand',
        pending && 'animate-pulse',
      )}
    >
      {pending && (
        <span className="absolute bottom-2 right-2 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
          Carregando dados…
        </span>
      )}
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <NativeCheckbox
          checked={selected}
          onChange={() => onToggle(p.id)}
          aria-label="Selecionar"
        />
        <span className="rounded bg-slate-900/80 backdrop-blur px-1.5 py-0.5 text-[10px] font-bold text-slate-200 border border-slate-700">
          {p.source}
        </span>
      </div>
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        {p.discountPct ? (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white shadow-sm">
            -{p.discountPct}%
          </span>
        ) : null}
        {p.shipping === 'FULL' && (
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
            ⚡ FULL
          </span>
        )}
        {p.shipping === 'FREE' && (
          <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
            🚚 Grátis
          </span>
        )}
      </div>
      <div className="mb-2 aspect-square overflow-hidden rounded bg-surface-2">
        {p.images[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </div>
      <p className="mb-1 line-clamp-2 text-xs font-medium" title={p.title}>
        {p.title}
      </p>
      <p className="text-sm font-semibold text-emerald-400">{formatBRL(p.price)}</p>
      {p.originalPrice && (
        <p className="text-xs text-muted-foreground line-through">{formatBRL(p.originalPrice)}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {p.salesCount !== null && <span>🔥 {p.salesCount} vendidos</span>}
        {p.commissionPct !== null && (
          <span className="text-brand font-medium">💰 {p.commissionPct}%</span>
        )}
        {p.couponCode && <span className="text-amber-300 font-medium">🎟️ {p.couponCode}</span>}
      </div>
      {shopeeCatId && (
        <button
          type="button"
          onClick={copyCatId}
          title="Copiar ID de categoria para usar em Explorar Categorias"
          className="mt-1 w-fit rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          🏷️ Categoria {shopeeCatId}
        </button>
      )}
      <Button size="sm" variant="secondary" className="mt-2 text-xs" onClick={() => onCopy(p)}>
        Copiar texto + link
      </Button>
    </div>
  );
}
