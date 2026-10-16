'use client';
import { useState } from 'react';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MARKETPLACE_CONFIGS } from '@/components/marketplaces/marketplace-config';
import { AFFILIATE_SUBID_FIELDS } from '@/components/marketplaces/affiliate-subid-fields';
import type { AffiliateRow } from '@/lib/types';

export interface AffiliatePayload {
  name: string;
  email: string;
  password?: string;
  subIds: Partial<Record<MarketplaceKind, string>>;
}

export function AffiliateFormDialog({
  open, onOpenChange, initial, pending, onSubmit, createdPassword,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: AffiliateRow;
  pending?: boolean;
  onSubmit: (p: AffiliatePayload) => void;
  /** Senha gerada, exibida uma única vez depois da criação. */
  createdPassword?: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [subIds, setSubIds] = useState<Partial<Record<MarketplaceKind, string>>>(initial?.subIds ?? {});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = Object.fromEntries(
      Object.entries(subIds).filter(([k, v]) => (initial ? true : Boolean(v?.trim())) && MARKETPLACE_KINDS.includes(k as MarketplaceKind)),
    ) as Partial<Record<MarketplaceKind, string>>;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      ...(password && !initial ? { password } : {}),
      subIds: clean,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar afiliado' : 'Novo afiliado'}</DialogTitle>
          <DialogDescription>
            O afiliado usa as suas APIs; aqui você cadastra só o identificador dele em cada plataforma.
          </DialogDescription>
        </DialogHeader>
        {createdPassword ? (
          <div className="grid gap-2 text-sm">
            <p>Afiliado criado. Anote a senha inicial — ela só é exibida agora:</p>
            <code className="rounded-md border border-border bg-surface px-3 py-2 text-base">{createdPassword}</code>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <div>
              <Label htmlFor="aff-name">Nome</Label>
              <Input id="aff-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="aff-email">E-mail</Label>
              <Input id="aff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {!initial && (
              <div>
                <Label htmlFor="aff-pass">Senha inicial</Label>
                <Input id="aff-pass" type="password" autoComplete="new-password" placeholder="Em branco = gerar automaticamente" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Identificadores por plataforma</legend>
              {MARKETPLACE_KINDS.map((kind) => {
                const f = AFFILIATE_SUBID_FIELDS[kind];
                const label = `${f.label} ${MARKETPLACE_CONFIGS[kind].label}`;
                return (
                  <div key={kind}>
                    <Label htmlFor={`aff-sub-${kind}`}>{label}</Label>
                    <Input id={`aff-sub-${kind}`} value={subIds[kind] ?? ''} onChange={(e) => setSubIds({ ...subIds, [kind]: e.target.value })} />
                  </div>
                );
              })}
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={pending}>{initial ? 'Salvar' : 'Criar afiliado'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
