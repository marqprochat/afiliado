'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import type { ApiCoupon } from '@/lib/types';
import { MARKETPLACE_KINDS, type MarketplaceKind, type CouponDiscountType } from '@afilados/shared';

interface Props {
  open: boolean;
  coupon: ApiCoupon | null;
  onClose: () => void;
}

const STORE_LABELS: Record<MarketplaceKind, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magazine Luiza',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
};

export function CouponFormDrawer({ open, coupon, onClose }: Props) {
  const qc = useQueryClient();
  const [store, setStore] = useState<MarketplaceKind>('SHOPEE');
  const [advertiserName, setAdvertiserName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType | 'NONE'>('NONE');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [minSpend, setMinSpend] = useState<string>('');
  const [startsAt, setStartsAt] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (coupon) {
      setStore(coupon.store);
      setAdvertiserName(coupon.advertiserName ?? '');
      setCode(coupon.code);
      setDescription(coupon.description);
      setTerms(coupon.terms ?? '');
      setDiscountType(coupon.discountType ?? 'NONE');
      setDiscountValue(coupon.discountValue ? String(coupon.discountValue) : '');
      setMinSpend(coupon.minSpend ? String(coupon.minSpend) : '');
      setStartsAt(coupon.startsAt ? coupon.startsAt.slice(0, 16) : '');
      setExpiresAt(coupon.expiresAt ? coupon.expiresAt.slice(0, 16) : '');
      setSourceUrl(coupon.sourceUrl ?? '');
    } else {
      setStore('SHOPEE');
      setAdvertiserName('');
      setCode('');
      setDescription('');
      setTerms('');
      setDiscountType('NONE');
      setDiscountValue('');
      setMinSpend('');
      setStartsAt('');
      setExpiresAt('');
      setSourceUrl('');
    }
    setError(null);
  }, [coupon, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const payload = {
        store,
        advertiserName: advertiserName.trim() || undefined,
        code: code.trim().toUpperCase(),
        description: description.trim(),
        terms: terms.trim() || undefined,
        discountType: discountType !== 'NONE' ? discountType : undefined,
        discountValue: discountValue ? Number(discountValue) : undefined,
        minSpend: minSpend ? Number(minSpend) : undefined,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      };

      if (coupon) {
        return apiFetch(`/coupons/${coupon.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }
      return apiFetch('/coupons', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.message || 'Erro ao salvar cupom');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Informe o código do cupom');
      return;
    }
    if (!description.trim()) {
      setError('Informe a descrição do cupom');
      return;
    }
    mutation.mutate();
  };

  return (
    <Drawer open={open} onOpenChange={(val) => !val && onClose()}>
      <DrawerContent className="max-w-xl mx-auto p-4 sm:p-6">
        <form onSubmit={handleSubmit}>
          <DrawerHeader className="px-0 pt-0">
            <DrawerTitle>{coupon ? 'Editar Cupom' : 'Novo Cupom'}</DrawerTitle>
            <DrawerDescription>
              {coupon
                ? 'Atualize os dados e condições do cupom.'
                : 'Cadastre um cupom de desconto manualmente.'}
            </DrawerDescription>
          </DrawerHeader>

          {error && (
            <div className="mb-4 p-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded-md border border-rose-200 dark:border-rose-900">
              {error}
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="store">Loja / Marketplace *</Label>
                <Select
                  value={store}
                  onValueChange={(val) => setStore(val as MarketplaceKind)}
                >
                  <SelectTrigger id="store" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {STORE_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="code">Código do Cupom *</Label>
                <Input
                  id="code"
                  placeholder="EX: PROMO10"
                  className="mt-1 uppercase font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            {store === 'AWIN' && (
              <div>
                <Label htmlFor="advertiserName">Anunciante (Awin)</Label>
                <Input
                  id="advertiserName"
                  placeholder="Ex: Casas Bahia, Nike..."
                  className="mt-1"
                  value={advertiserName}
                  onChange={(e) => setAdvertiserName(e.target.value)}
                />
              </div>
            )}

            <div>
              <Label htmlFor="description">Descrição do Desconto *</Label>
              <Input
                id="description"
                placeholder="Ex: R$ 20 OFF em compras acima de R$ 100"
                className="mt-1"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="discountType">Tipo de Desconto</Label>
                <Select
                  value={discountType}
                  onValueChange={(val) =>
                    setDiscountType(val as CouponDiscountType | 'NONE')
                  }
                >
                  <SelectTrigger id="discountType" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Não especificado</SelectItem>
                    <SelectItem value="PERCENT">Porcentagem (%)</SelectItem>
                    <SelectItem value="FIXED">Valor Fixo (R$)</SelectItem>
                    <SelectItem value="FREE_SHIPPING">Frete Grátis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="discountValue">Valor do Desconto</Label>
                <Input
                  id="discountValue"
                  type="number"
                  step="0.01"
                  placeholder="Ex: 10"
                  className="mt-1"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="minSpend">Gasto Mínimo (R$)</Label>
                <Input
                  id="minSpend"
                  type="number"
                  step="0.01"
                  placeholder="Ex: 50"
                  className="mt-1"
                  value={minSpend}
                  onChange={(e) => setMinSpend(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startsAt">Início da Validade</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  className="mt-1 text-xs"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="expiresAt">Fim da Validade (Expira)</Label>
                <Input
                  id="expiresAt"
                  type="datetime-local"
                  className="mt-1 text-xs"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="sourceUrl">Link de Origem / Regras</Label>
              <Input
                id="sourceUrl"
                type="url"
                placeholder="https://..."
                className="mt-1"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="terms">Termos e Condições / Exceções</Label>
              <Textarea
                id="terms"
                placeholder="Ex: Válido apenas para produtos selecionados..."
                className="mt-1 h-20 text-xs"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
          </div>

          <DrawerFooter className="px-0 pb-0 pt-4 flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Salvando…' : coupon ? 'Salvar Alterações' : 'Criar Cupom'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
