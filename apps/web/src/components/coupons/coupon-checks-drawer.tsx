'use client';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { useCouponChecks } from '@/lib/queries';
import type { ApiCoupon } from '@/lib/types';
import { CouponStatusBadge } from './coupon-status-badge';

interface Props {
  coupon: ApiCoupon | null;
  onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  MANUAL: 'Verificação Manual',
  EXTENSION: 'Extensão no Carrinho',
  SOURCE: 'API do Marketplace',
  EXPIRY: 'Varredura de Expiração',
};

export function CouponChecksDrawer({ coupon, onClose }: Props) {
  const { data: checks, isLoading } = useCouponChecks(coupon?.id ?? null);

  return (
    <Drawer open={!!coupon} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-w-xl mx-auto p-4 sm:p-6">
        <DrawerHeader className="px-0 pt-0">
          <DrawerTitle className="flex items-center gap-2">
            <span>Histórico de Verificação:</span>
            <span className="font-mono text-primary font-bold">{coupon?.code}</span>
          </DrawerTitle>
          <DrawerDescription>
            {coupon?.store} — {coupon?.description}
          </DrawerDescription>
        </DrawerHeader>

        <div className="mt-4 max-h-[60vh] overflow-y-auto space-y-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Carregando histórico…
            </div>
          )}

          {!isLoading && (!checks || checks.length === 0) && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Nenhuma verificação registrada para este cupom.
            </div>
          )}

          {checks?.map((c) => (
            <div
              key={c.id}
              className="p-3 rounded-lg border border-border bg-card flex flex-col gap-1 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">
                  {METHOD_LABELS[c.method] ?? c.method}
                </span>
                <CouponStatusBadge status={c.result} />
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString('pt-BR')}
              </div>
              {c.note && (
                <div className="mt-1 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  {c.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
