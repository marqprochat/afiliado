'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCoupons } from '@/lib/queries';
import { apiFetch } from '@/lib/api';
import type { ApiCoupon } from '@/lib/types';
import { CouponStatusBadge } from '@/components/coupons/coupon-status-badge';
import { CouponFormDrawer } from '@/components/coupons/coupon-form-drawer';
import { CouponParseModal } from '@/components/coupons/coupon-parse-modal';
import { CouponChecksDrawer } from '@/components/coupons/coupon-checks-drawer';
import {
  MARKETPLACE_KINDS,
  type MarketplaceKind,
  COUPON_STATUSES,
  COUPON_ORIGINS,
} from '@afilados/shared';

const STORE_LABELS: Record<MarketplaceKind, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
};

const ORIGIN_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  API: 'API Automática',
  EXTENSION: 'Extensão',
  IMPORT: 'Importação',
  MIRROR: 'Espelhamento',
};

export default function CuponsPage() {
  const qc = useQueryClient();
  const [storeFilter, setStoreFilter] = useState<MarketplaceKind | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [originFilter, setOriginFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);

  // Modais e Drawers
  const [formOpen, setFormOpen] = useState(false);
  const [parseOpen, setParseOpen] = useState(false);
  const [selectedCouponForEdit, setSelectedCouponForEdit] = useState<ApiCoupon | null>(null);
  const [selectedCouponForChecks, setSelectedCouponForChecks] = useState<ApiCoupon | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const { data: coupons, isLoading } = useCoupons({
    store: storeFilter !== 'ALL' ? storeFilter : undefined,
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    origin: originFilter !== 'ALL' ? originFilter : undefined,
    q: searchQuery.trim() || undefined,
    includeExpired,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncFeedback(null);
      return apiFetch<{ queued: boolean; results?: any[] }>('/coupons/sync', {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
      if (res.queued) {
        setSyncFeedback('Sincronização em segundo plano iniciada.');
      } else {
        setSyncFeedback('Cupons sincronizados com sucesso!');
      }
      setTimeout(() => setSyncFeedback(null), 5000);
    },
    onError: (err: any) => {
      setSyncFeedback(`Erro ao sincronizar: ${err?.message || 'Falha na requisição'}`);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ id, result }: { id: string; result: 'VALID' | 'INVALID' }) => {
      return apiFetch(`/coupons/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ result }),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/coupons/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (err: any) => {
      alert(err?.message || 'Erro ao excluir cupom');
    },
  });

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleOpenCreate = () => {
    setSelectedCouponForEdit(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (coupon: ApiCoupon) => {
    setSelectedCouponForEdit(coupon);
    setFormOpen(true);
  };

  const handleDelete = (id: string, code: string) => {
    if (confirm(`Deseja realmente excluir o cupom ${code}?`)) {
      deleteMutation.mutate(id);
    }
  };

  const validCount = coupons?.filter((c) => c.status === 'VALID').length ?? 0;
  const unverifiedCount = coupons?.filter((c) => c.status === 'UNVERIFIED').length ?? 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Central de Cupons</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie, valide e importe cupons promocionais para seus envios automáticos e manuais.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? 'Sincronizando…' : '🔄 Sincronizar APIs'}
          </Button>

          <Button variant="outline" size="sm" onClick={() => setParseOpen(true)}>
            📋 Importar de Texto
          </Button>

          <Button size="sm" onClick={handleOpenCreate}>
            + Novo Cupom
          </Button>
        </div>
      </div>

      {syncFeedback && (
        <div className="p-3 text-xs bg-muted text-foreground rounded-lg border border-border flex items-center justify-between">
          <span>{syncFeedback}</span>
          <button
            type="button"
            onClick={() => setSyncFeedback(null)}
            className="text-muted-foreground hover:text-foreground font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-xs text-muted-foreground font-medium">Total de Cupons</div>
          <div className="text-2xl font-bold mt-1 text-foreground">{coupons?.length ?? 0}</div>
        </div>
        <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            Cupons Válidos
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {validCount}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
          <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            Não Verificados
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
            {unverifiedCount}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <Switch
              id="expiredToggle"
              checked={includeExpired}
              onCheckedChange={setIncludeExpired}
            />
            <Label htmlFor="expiredToggle" className="text-xs font-medium cursor-pointer">
              Exibir expirados
            </Label>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-card p-3 rounded-xl border border-border">
        <div>
          <Input
            placeholder="Buscar por código, descrição..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div>
          <Select
            value={storeFilter}
            onValueChange={(v) => setStoreFilter(v as MarketplaceKind | 'ALL')}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Todas as Lojas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as Lojas</SelectItem>
              {MARKETPLACE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {STORE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? 'ALL')}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Todos os Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os Status</SelectItem>
              {COUPON_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select
            value={originFilter}
            onValueChange={(v) => setOriginFilter(v ?? 'ALL')}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Todas as Origens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as Origens</SelectItem>
              {COUPON_ORIGINS.map((o) => (
                <SelectItem key={o} value={o}>
                  {ORIGIN_LABELS[o] ?? o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Coupons Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Desconto / Mínimo</TableHead>
              <TableHead className="min-w-[180px]">Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Carregando cupons…
                </TableCell>
              </TableRow>
            )}

            {!isLoading && (!coupons || coupons.length === 0) && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Nenhum cupom encontrado para os filtros selecionados.
                </TableCell>
              </TableRow>
            )}

            {coupons?.map((c) => {
              const expiresDate = c.expiresAt ? new Date(c.expiresAt) : null;
              const isExpired = expiresDate && expiresDate.getTime() < Date.now();

              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <div>
                      <span>{STORE_LABELS[c.store] ?? c.store}</span>
                      {c.advertiserName && (
                        <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {c.advertiserName}
                        </div>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5 font-mono font-bold text-primary">
                      <span>{c.code}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(c.code)}
                        className="p-1 hover:bg-muted rounded text-xs text-muted-foreground hover:text-foreground"
                        title="Copiar código"
                      >
                        {copiedCode === c.code ? '✓' : '📋'}
                      </button>
                    </div>
                  </TableCell>

                  <TableCell className="text-xs whitespace-nowrap">
                    <div>
                      {c.discountValue ? (
                        <span className="font-medium">
                          {c.discountType === 'PERCENT'
                            ? `${c.discountValue}% OFF`
                            : `R$ ${c.discountValue} OFF`}
                        </span>
                      ) : c.discountType === 'FREE_SHIPPING' ? (
                        <span className="font-medium text-emerald-600">Frete Grátis</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    {c.minSpend && (
                      <div className="text-muted-foreground text-[11px]">
                        Mín. R$ {c.minSpend}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-xs">
                    <div className="max-w-[260px] truncate" title={c.description}>
                      {c.description}
                    </div>
                  </TableCell>

                  <TableCell>
                    <CouponStatusBadge
                      status={c.status}
                      onClick={() => setSelectedCouponForChecks(c)}
                    />
                  </TableCell>

                  <TableCell className="text-xs whitespace-nowrap">
                    {c.expiresAt ? (
                      <span className={isExpired ? 'text-rose-500 font-medium' : 'text-muted-foreground'}>
                        {new Date(c.expiresAt).toLocaleDateString('pt-BR')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Sem data</span>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {ORIGIN_LABELS[c.origin] ?? c.origin}
                  </TableCell>

                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {c.status !== 'VALID' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                          title="Marcar como Válido"
                          onClick={() => verifyMutation.mutate({ id: c.id, result: 'VALID' })}
                        >
                          ✓
                        </Button>
                      )}

                      {c.status !== 'INVALID' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                          title="Marcar como Inválido"
                          onClick={() => verifyMutation.mutate({ id: c.id, result: 'INVALID' })}
                        >
                          ✕
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleOpenEdit(c)}
                      >
                        Editar
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                        onClick={() => handleDelete(c.id, c.code)}
                      >
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Drawers e Modais */}
      <CouponFormDrawer
        open={formOpen}
        coupon={selectedCouponForEdit}
        onClose={() => {
          setFormOpen(false);
          setSelectedCouponForEdit(null);
        }}
      />

      <CouponParseModal
        open={parseOpen}
        onClose={() => setParseOpen(false)}
      />

      <CouponChecksDrawer
        coupon={selectedCouponForChecks}
        onClose={() => setSelectedCouponForChecks(null)}
      />
    </div>
  );
}
