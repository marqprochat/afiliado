'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useAffiliates, useMe } from '@/lib/queries';
import type { AffiliateRow } from '@/lib/types';
import { AffiliateFormDialog, type AffiliatePayload } from './affiliate-form-dialog';

export function AffiliatesClient() {
  const { data: me } = useMe();
  const isAdmin = me?.user.isSuperAdmin === true;
  const { data: rows = [] } = useAffiliates(isAdmin);
  const [editing, setEditing] = useState<AffiliateRow | 'new' | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null);

  const save = useApiMutation(
    (p: AffiliatePayload) =>
      editing && editing !== 'new'
        ? apiFetch<AffiliateRow>(`/admin/affiliates/${editing.id}`, { method: 'PATCH', json: p })
        : apiFetch<AffiliateRow & { initialPassword?: string }>('/admin/affiliates', {
            method: 'POST',
            json: p,
          }),
    {
      invalidate: [['admin', 'affiliates']],
      onSuccess: (out) => {
        const pwd = (out as { initialPassword?: string }).initialPassword;
        if (pwd) setCreatedPassword(pwd);
        else setEditing(null);
      },
    },
  );
  const toggle = useApiMutation(
    (a: AffiliateRow) =>
      apiFetch(`/admin/affiliates/${a.id}/active`, { method: 'POST', json: { active: !a.active } }),
    { invalidate: [['admin', 'affiliates']], success: 'Status atualizado' },
  );
  const reset = useApiMutation(
    (a: AffiliateRow) =>
      apiFetch<{ password: string }>(`/admin/affiliates/${a.id}/reset-password`, {
        method: 'POST',
        json: {},
      }),
    { onSuccess: (out, a) => setResetResult({ name: a.name, password: out.password }) },
  );
  const impersonate = useApiMutation(
    (a: AffiliateRow) => apiFetch(`/admin/affiliates/${a.id}/impersonate`, { method: 'POST' }),
    { onSuccess: () => window.location.assign('/') },
  );

  if (me && !isAdmin) {
    return <p className="text-sm text-muted-foreground">Área restrita ao SuperAdmin.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Afiliados</h1>
          <p className="text-sm text-muted-foreground">
            Contas que usam as suas APIs, com WhatsApp, grupos e fila próprios.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreatedPassword(null);
            setEditing('new');
          }}
        >
          Novo afiliado
        </Button>
      </div>

      {resetResult && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm">
          Nova senha de {resetResult.name}: <code>{resetResult.password}</code> (exibida só agora).
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>WhatsApp</TableHead>
            <TableHead>Grupos</TableHead>
            <TableHead>Envios 7d</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.name}</TableCell>
              <TableCell>{a.email}</TableCell>
              <TableCell>{a.active ? 'Ativo' : 'Desativado'}</TableCell>
              <TableCell>{a.waConnected ? 'Conectado' : '—'}</TableCell>
              <TableCell>{a.groups}</TableCell>
              <TableCell>{a.sends7d}</TableCell>
              <TableCell>{formatDateTime(a.createdAt)}</TableCell>
              <TableCell className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => impersonate.mutate(a)}>
                  Entrar como
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCreatedPassword(null);
                    setEditing(a);
                  }}
                >
                  Editar
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggle.mutate(a)}>
                  {a.active ? 'Desativar' : 'Ativar'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => reset.mutate(a)}>
                  Redefinir senha
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editing && (
        <AffiliateFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(v) => {
            if (!v) {
              setEditing(null);
              setCreatedPassword(null);
            }
          }}
          {...(editing !== 'new' ? { initial: editing } : {})}
          pending={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          createdPassword={createdPassword}
        />
      )}
    </div>
  );
}
