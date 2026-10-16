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
  function confirmDeactivate(a: AffiliateRow) {
    if (!a.active) return toggle.mutate(a);
    if (window.confirm(`Desativar ${a.name}? O afiliado perde o acesso e os envios param.`))
      toggle.mutate(a);
  }
  function confirmReset(a: AffiliateRow) {
    if (window.confirm(`Redefinir a senha de ${a.name}? A senha atual deixa de valer.`)) {
      setResetResult(null);
      reset.mutate(a);
    }
  }
  const impersonate = useApiMutation(
    (a: AffiliateRow) => apiFetch(`/admin/affiliates/${a.id}/impersonate`, { method: 'POST' }),
    { onSuccess: () => window.location.assign('/') },
  );

  if (!me) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (!isAdmin) {
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
            setResetResult(null);
            setEditing('new');
          }}
        >
          Novo afiliado
        </Button>
      </div>

      {resetResult && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
          <p>
            Nova senha de {resetResult.name}: <code>{resetResult.password}</code> (exibida só
            agora).
          </p>
          <Button size="sm" variant="outline" onClick={() => setResetResult(null)}>
            Fechar
          </Button>
        </div>
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
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Entrar como ${a.name}`}
                    onClick={() => impersonate.mutate(a)}
                  >
                    Entrar como
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Editar ${a.name}`}
                    onClick={() => {
                      setCreatedPassword(null);
                      setResetResult(null);
                      setEditing(a);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${a.active ? 'Desativar' : 'Ativar'} ${a.name}`}
                    onClick={() => confirmDeactivate(a)}
                  >
                    {a.active ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Redefinir senha de ${a.name}`}
                    onClick={() => confirmReset(a)}
                  >
                    Redefinir senha
                  </Button>
                </div>
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
