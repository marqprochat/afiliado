'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import type { CouponCandidateItem } from '@/lib/types';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';

interface Props {
  open: boolean;
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

export function CouponParseModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [defaultStore, setDefaultStore] = useState<MarketplaceKind | 'AUTO'>('AUTO');
  const [candidates, setCandidates] = useState<CouponCandidateItem[]>([]);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'INPUT' | 'REVIEW'>('INPUT');
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setText('');
    setDefaultStore('AUTO');
    setCandidates([]);
    setSelectedIdxs(new Set());
    setStep('INPUT');
    setError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const parseMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await apiFetch<{ candidates: CouponCandidateItem[] }>('/coupons/parse', {
        method: 'POST',
        body: JSON.stringify({
          text,
          ...(defaultStore !== 'AUTO' ? { store: defaultStore } : {}),
        }),
      });
      return res.candidates;
    },
    onSuccess: (data) => {
      if (data.length === 0) {
        setError('Nenhum código de cupom foi identificado no texto colado.');
        return;
      }
      setCandidates(data);
      // Seleciona por padrão os que NÃO existem ainda no banco
      const toSelect = new Set<number>();
      data.forEach((c, idx) => {
        if (!c.exists && c.store) {
          toSelect.add(idx);
        }
      });
      setSelectedIdxs(toSelect);
      setStep('REVIEW');
    },
    onError: (err: any) => {
      setError(err?.message || 'Erro ao analisar texto');
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const toImport = candidates
        .filter((_, idx) => selectedIdxs.has(idx))
        .map((c) => ({
          store: c.store || (defaultStore !== 'AUTO' ? defaultStore : 'SHOPEE'),
          code: c.code,
          description: c.description,
          discountType: c.discountType,
          discountValue: c.discountValue,
          minSpend: c.minSpend,
        }));

      if (toImport.length === 0) {
        throw new Error('Selecione ao menos um cupom para importar');
      }

      return apiFetch<{ created: number; skipped: number }>('/coupons/bulk', {
        method: 'POST',
        body: JSON.stringify({ coupons: toImport }),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
      handleClose();
    },
    onError: (err: any) => {
      setError(err?.message || 'Erro ao importar cupons');
    },
  });

  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIdxs);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIdxs(next);
  };

  const selectAll = () => {
    if (selectedIdxs.size === candidates.length) {
      setSelectedIdxs(new Set());
    } else {
      setSelectedIdxs(new Set(candidates.map((_, i) => i)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Cupons de Texto Livre</DialogTitle>
          <DialogDescription>
            {step === 'INPUT'
              ? 'Cole mensagens de grupos, posts ou e-mails contendo cupons para extração automática.'
              : `Encontramos ${candidates.length} cupons no texto. Revise os itens antes de cadastrar.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded-md border border-rose-200 dark:border-rose-900">
            {error}
          </div>
        )}

        {step === 'INPUT' ? (
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="defaultStore">Loja Padrão (Fallback se não detectada no texto)</Label>
              <Select
                value={defaultStore}
                onValueChange={(val) => setDefaultStore(val as MarketplaceKind | 'AUTO')}
              >
                <SelectTrigger id="defaultStore" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Detectar automaticamente</SelectItem>
                  {MARKETPLACE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {STORE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="importText">Texto com Cupons</Label>
              <Textarea
                id="importText"
                placeholder="Exemplo:
🔥 CUPOM SHOPEE: use TECH10 para 10% OFF em eletrônicos acima de R$ 50
📦 Mercado Livre: cupom FRETEGRATIS acima de R$ 79
..."
                className="mt-1 h-44 font-mono text-xs"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="h-7 text-xs px-2"
              >
                {selectedIdxs.size === candidates.length
                  ? 'Desmarcar Todos'
                  : 'Selecionar Todos'}
              </Button>
              <span>
                {selectedIdxs.size} de {candidates.length} selecionados
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {candidates.map((c, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-sm flex items-start gap-3 transition-colors ${
                    selectedIdxs.has(idx)
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <Checkbox
                    id={`candidate-${idx}`}
                    checked={selectedIdxs.has(idx)}
                    onCheckedChange={() => toggleSelect(idx)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-primary">{c.code}</span>
                      {c.store && (
                        <span className="text-xs px-2 py-0.5 rounded bg-muted font-medium">
                          {STORE_LABELS[c.store] ?? c.store}
                        </span>
                      )}
                      {c.exists && (
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30">
                          Já cadastrado
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {c.description}
                    </div>
                    {(c.discountValue || c.minSpend) && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
                        {c.discountValue && (
                          <span>
                            Desconto:{' '}
                            {c.discountType === 'PERCENT'
                              ? `${c.discountValue}%`
                              : `R$ ${c.discountValue}`}
                          </span>
                        )}
                        {c.minSpend && <span>Mínimo: R$ {c.minSpend}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-end gap-2 pt-2">
          {step === 'REVIEW' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('INPUT')}
              disabled={importMutation.isPending}
            >
              Voltar ao Texto
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={parseMutation.isPending || importMutation.isPending}
          >
            Cancelar
          </Button>
          {step === 'INPUT' ? (
            <Button
              type="button"
              onClick={() => parseMutation.mutate()}
              disabled={!text.trim() || parseMutation.isPending}
            >
              {parseMutation.isPending ? 'Analisando…' : 'Analisar Texto'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={selectedIdxs.size === 0 || importMutation.isPending}
            >
              {importMutation.isPending
                ? 'Importando…'
                : `Importar (${selectedIdxs.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
