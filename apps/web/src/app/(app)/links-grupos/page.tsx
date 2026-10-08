'use client';
import { useState } from 'react';
import { Link2, Plus, Search, Users, Activity, MousePointerClick, RefreshCw, Sparkles, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupLinkCard } from '@/components/group-links/group-link-card';
import { GroupLinkFormDialog } from '@/components/group-links/group-link-form-dialog';
import { GroupLinkReorderDialog } from '@/components/group-links/group-link-reorder-dialog';
import { useGroupLinks } from '@/lib/queries';

export default function LinksGruposPage() {
  const { data: links = [], isLoading, refetch, isRefetching } = useGroupLinks();
  const [showCreate, setShowCreate] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [search, setSearch] = useState('');

  const activeLinksCount = links.filter((l) => l.status === 'ACTIVE').length;
  const totalGroupsCount = links.reduce((sum, l) => sum + (l._count?.groups ?? 0), 0);
  const totalClicksCount = links.reduce((sum, l) => sum + l.clickCount, 0);

  const filteredLinks = links.filter((l) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      l.label.toLowerCase().includes(q) ||
      l.slug.toLowerCase().includes(q) ||
      l.baseName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Link2 className="h-6 w-6 text-brand" />
            Links Fixos de Grupos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Links públicos inteligentes que rotacionam automaticamente para novos grupos de WhatsApp
            ao atingir o limite de membros.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReorder(true)}
            disabled={links.length <= 1}
            className="gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
          >
            <ListOrdered className="h-4 w-4" />
            Organizar Ordem da Landpage
          </Button>
          <a
            href="/landpage"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/20 hover:text-indigo-300 text-xs font-semibold transition"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>Ver Landing Page</span>
          </a>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Novo Link Fixo
          </Button>
        </div>
      </div>

      {/* Métricas / Visão Geral */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3.5 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-medium">Links Cadastrados</div>
            <div className="text-2xl font-bold">{links.length}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3.5 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-medium">Links Ativos</div>
            <div className="text-2xl font-bold">{activeLinksCount}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3.5 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-medium">Grupos Gerenciados</div>
            <div className="text-2xl font-bold">{totalGroupsCount}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3.5 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
            <MousePointerClick className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground font-medium">Cliques Totais</div>
            <div className="text-2xl font-bold">{totalClicksCount}</div>
          </div>
        </div>
      </div>

      {/* Barra de Busca e Filtro */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por rótulo, slug ou nome base..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Lista de Links Fixos */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Carregando links de grupos...
        </div>
      ) : filteredLinks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
            <Link2 className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-base">Nenhum link fixo encontrado</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {search
                ? 'Nenhum resultado corresponde aos termos da sua busca.'
                : 'Crie seu primeiro link fixo para nunca mais perder leads por grupos lotados no WhatsApp.'}
            </p>
          </div>
          {!search && (
            <Button onClick={() => setShowCreate(true)} className="mt-2 gap-1.5">
              <Plus className="h-4 w-4" />
              Criar Primeiro Link Fixo
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredLinks.map((link) => (
            <GroupLinkCard key={link.id} link={link} />
          ))}
        </div>
      )}

      {/* Modal de Criação */}
      <GroupLinkFormDialog open={showCreate} onOpenChange={setShowCreate} />

      {/* Modal de Reorganização da Ordem na Landpage */}
      <GroupLinkReorderDialog open={showReorder} onOpenChange={setShowReorder} links={links} />
    </div>
  );
}
