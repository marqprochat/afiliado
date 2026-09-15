'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MirrorRuleBody } from '@afilados/shared';
import { MirrorLogTable } from '@/components/mirror/log-table';
import { MirrorRuleForm } from '@/components/mirror/rule-form';
import { MirrorRuleList } from '@/components/mirror/rule-list';
import { apiFetch } from '@/lib/api';
import {
  useGroups,
  useMirrorLogs,
  useMirrorRules,
  useMirrorStats,
  useSessions,
  useTemplates,
} from '@/lib/queries';
import type { MirrorRule } from '@/lib/types';

export default function EspelhamentoPage() {
  const qc = useQueryClient();
  const { data: sessions = [] } = useSessions();
  const connected = sessions.filter((s) => s.status === 'CONNECTED');
  const [selectedSessionId, setSelectedSessionId] = useState(connected[0]?.id ?? '');
  const { data: groups = [] } = useGroups(selectedSessionId || null);
  const { data: templates = [] } = useTemplates();
  const { data: rules = [] } = useMirrorRules();
  const { data: stats } = useMirrorStats();

  const [statusFilter, setStatusFilter] = useState('');
  const { data: logs = [] } = useMirrorLogs({
    status: statusFilter || undefined,
    limit: 100,
  });

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: MirrorRuleBody) =>
      apiFetch<MirrorRule>('/mirror/rules', {
        method: 'POST',
        json: data,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mirror', 'rules'] });
    },
  });

  const handleCreate = async (data: MirrorRuleBody) => {
    await createMutation.mutateAsync(data);
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/v1/mirror/rules/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        void qc.invalidateQueries({ queryKey: ['mirror', 'rules'] });
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este espelhamento e todos os seus logs?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/mirror/rules/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        void qc.invalidateQueries({ queryKey: ['mirror', 'rules'] });
        void qc.invalidateQueries({ queryKey: ['mirror', 'logs'] });
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Espelhamento de Grupos (Mirroring)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Capture mensagens de grupos de terceiros e retransmita para os seus grupos com links de
          afiliado substituídos automaticamente.
        </p>
      </div>

      {/* Banner Informativo */}
      <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-foreground">
        <p className="font-semibold text-brand">Aviso importante:</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Somente links oficiais das lojas <strong>Shopee</strong>, <strong>Amazon</strong>,{' '}
          <strong>Mercado Livre</strong> e <strong>Magalu</strong> são espelhados. Mensagens sem
          links ou com links desconhecidos são ignoradas e registradas nos logs.
        </p>
      </div>

      {/* Cards de Métricas do Dia */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Espelhadas hoje</span>
          <p className="text-2xl font-bold text-emerald-500 mt-1">{stats?.today.mirrored ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Descartadas hoje</span>
          <p className="text-2xl font-bold text-amber-500 mt-1">{stats?.today.discarded ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">Erros hoje</span>
          <p className="text-2xl font-bold text-red-400 mt-1">{stats?.today.error ?? 0}</p>
        </div>
      </div>

      {/* Formulário de Criação de Regra */}
      <MirrorRuleForm
        sessions={sessions}
        groups={groups}
        templates={templates}
        selectedSessionId={selectedSessionId}
        onSessionChange={setSelectedSessionId}
        onSubmit={handleCreate}
        loading={createMutation.isPending}
      />

      {/* Lista de Regras Configuradas */}
      <MirrorRuleList
        rules={rules}
        onToggle={handleToggle}
        onDelete={handleDelete}
        togglingId={togglingId}
        deletingId={deletingId}
      />

      {/* Tabela de Logs */}
      <MirrorLogTable
        logs={logs}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />
    </div>
  );
}
