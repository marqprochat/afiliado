'use client';
import type { CouponStatus } from '@afilados/shared';

interface Props {
  status: CouponStatus;
  onClick?: () => void;
  className?: string;
}

const LABELS: Record<CouponStatus, string> = {
  VALID: 'Válido',
  UNVERIFIED: 'Não verificado',
  INVALID: 'Inválido',
  EXPIRED: 'Expirado',
};

const STYLES: Record<CouponStatus, string> = {
  VALID: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  UNVERIFIED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  INVALID: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  EXPIRED: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30 line-through',
};

export function CouponStatusBadge({ status, onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
        STYLES[status] ?? STYLES.UNVERIFIED
      } ${onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} ${className}`}
      title={onClick ? 'Clique para ver histórico de verificações' : undefined}
    >
      {LABELS[status] ?? status}
    </button>
  );
}
