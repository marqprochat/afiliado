'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card3D } from './3d-card';
import {
  Users,
  Search,
  Sparkles,
  Copy,
  Tag,
  ShieldCheck,
  Flame,
  ArrowRight,
  Smartphone,
  Laptop,
  Ticket,
  Zap,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

export interface PublicGroupLink {
  id: string;
  slug: string;
  label: string; // Rótulo / Identidade
  baseName: string;
  customText: string;
  groupDescription: string | null;
  groupImageBase64: string | null;
  clickCount: number;
  status: string;
  memberLimit: number;
  activeGroup: {
    name: string;
    memberCount: number;
  } | null;
  redirectUrl: string;
}

// Fallback demo links tailored to Dudu Rocha Tech deals
const DUDU_ROCHA_DEMO_LINKS: PublicGroupLink[] = [
  {
    id: 'dudu-1',
    slug: 'dudu-ofertas-vip',
    label: '🔥 GERAL / PROMOS VIP',
    baseName: 'Dudu Rocha | Grupo VIP de Ofertas #01',
    customText: 'As melhores promoções de tecnologia selecionadas a dedo pela equipe do Dudu Rocha.',
    groupDescription: 'Smartphones, hardware, eletrônicos, cupons diários e bugs de preço com desconto real.',
    groupImageBase64: null,
    clickCount: 5430,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '🔥 DUDU ROCHA OFERTAS VIP #14',
      memberCount: 940,
    },
    redirectUrl: '/g/dudu-ofertas-vip',
  },
  {
    id: 'dudu-2',
    slug: 'dudu-smartphones',
    label: '📱 SMARTPHONES & IPHONES',
    baseName: 'Dudu Rocha | Celulares & Acessórios',
    customText: 'Samsung Galaxy, iPhones, Xiaomi e Motorola pelo menor preço histórico.',
    groupDescription: 'Monitore quedas de preço e lançamentos com links 100% confiáveis.',
    groupImageBase64: null,
    clickCount: 3820,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '📱 DUDU ROCHA SMARTPHONES #08',
      memberCount: 885,
    },
    redirectUrl: '/g/dudu-smartphones',
  },
  {
    id: 'dudu-3',
    slug: 'dudu-notebooks-hardware',
    label: '💻 NOTEBOOKS & SETUP TECH',
    baseName: 'Dudu Rocha | Notebooks & PC Gamer',
    customText: 'Laptops de trabalho, MacBooks, periféricos e monitores com cupons aplicados.',
    groupDescription: 'Compre o melhor notebook para suas necessidades economizando até 40%.',
    groupImageBase64: null,
    clickCount: 2950,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '💻 NOTEBOOKS & HARDWARE #04',
      memberCount: 790,
    },
    redirectUrl: '/g/dudu-notebooks-hardware',
  },
  {
    id: 'dudu-4',
    slug: 'dudu-cupons-secretos',
    label: '🎟️ CUPONS & BUGS',
    baseName: 'Dudu Rocha | Cupons & Descontos Secretos',
    customText: 'Cupons exclusivos de Mercado Livre, Shopee, Amazon, Magalu e AliExpress.',
    groupDescription: 'Notificações relâmpago de bugs de frete grátis e códigos de desconto ativos.',
    groupImageBase64: null,
    clickCount: 6810,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '🎟️ DUDU ROCHA CUPONS #22',
      memberCount: 982,
    },
    redirectUrl: '/g/dudu-cupons-secretos',
  },
];

// Color mapping for label badges
const LABEL_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  '🔥 GERAL / PROMOS VIP': {
    bg: 'bg-emerald-500/10',
    text: 'text-[#27c40b]',
    border: 'border-[#27c40b]/40',
    glow: 'rgba(39, 196, 11, 0.25)',
  },
  '📱 SMARTPHONES & IPHONES': {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/40',
    glow: 'rgba(6, 182, 212, 0.25)',
  },
  '💻 NOTEBOOKS & SETUP TECH': {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/40',
    glow: 'rgba(59, 130, 246, 0.25)',
  },
  '🎟️ CUPONS & BUGS': {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/40',
    glow: 'rgba(245, 158, 11, 0.25)',
  },
};

export function GroupListSection() {
  const [links, setLinks] = useState<PublicGroupLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLabel, setSelectedLabel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUsingDemo, setIsUsingDemo] = useState(false);

  useEffect(() => {
    async function fetchPublicGroups() {
      try {
        const res = await fetch('/api/v1/public/group-links');
        if (res.ok) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
            setLinks(json.data);
            setIsUsingDemo(false);
          } else {
            setLinks(DUDU_ROCHA_DEMO_LINKS);
            setIsUsingDemo(true);
          }
        } else {
          setLinks(DUDU_ROCHA_DEMO_LINKS);
          setIsUsingDemo(true);
        }
      } catch {
        setLinks(DUDU_ROCHA_DEMO_LINKS);
        setIsUsingDemo(true);
      } finally {
        setLoading(false);
      }
    }

    fetchPublicGroups();
  }, []);

  // Extract unique labels / identidades dynamically from available group links
  const uniqueLabels = useMemo(() => {
    const labels = new Set<string>();
    links.forEach((link) => {
      if (link.label) labels.add(link.label.trim());
    });
    return Array.from(labels);
  }, [links]);

  // Filter links based on label selection and search query
  const filteredLinks = useMemo(() => {
    return links.filter((link) => {
      const matchesLabel =
        selectedLabel === 'ALL' ||
        link.label.toLowerCase().trim() === selectedLabel.toLowerCase().trim();

      const matchesSearch =
        !searchQuery ||
        link.baseName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        link.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        link.customText.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (link.groupDescription &&
          link.groupDescription.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesLabel && matchesSearch;
    });
  }, [links, selectedLabel, searchQuery]);

  const handleCopyLink = (slug: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}/g/${slug}`;
    navigator.clipboard.writeText(fullUrl);
    toast.success('Link do grupo copiado com sucesso!', {
      description: fullUrl,
    });
  };

  return (
    <section id="grupos" className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#27c40b]/10 border border-[#27c40b]/30 text-[#27c40b] text-xs sm:text-sm font-bold mb-4 backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-[#27c40b] animate-pulse" />
          <span>Comunidade Oficial do Canal Dudu Rocha</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white mb-4">
          Escolha o seu <span className="bg-gradient-to-r from-[#27c40b] via-[#00d084] to-cyan-400 bg-clip-text text-transparent">Grupo de Ofertas</span>
        </h2>
        <p className="text-slate-300 text-sm sm:text-base lg:text-lg">
          Entre gratuitamente nos canais e grupos oficiais do Dudu Rocha. Economize em celulares, notebooks, TVs e cupons exclusivos.
        </p>
      </div>

      {/* Rótulo / Identity Filter Bar & Search */}
      <div className="mb-10 flex flex-col gap-6">
        {/* Search Input Bar */}
        <div className="relative max-w-xl mx-auto w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar grupo por assunto, smartphone, cupom..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#27c40b]/50 focus:border-[#27c40b] transition shadow-inner backdrop-blur-xl text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white bg-slate-800 px-2 py-1 rounded-md"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Identity / Rótulo Pills Filter */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={() => setSelectedLabel('ALL')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 flex items-center gap-2 border ${
              selectedLabel === 'ALL'
                ? 'bg-gradient-to-r from-[#27c40b] to-emerald-600 text-black border-[#27c40b] shadow-lg shadow-emerald-500/25 scale-105'
                : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Todos os Grupos</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-black/40 text-white font-bold">
              {links.length}
            </span>
          </button>

          {uniqueLabels.map((lbl) => {
            const count = links.filter((l) => l.label.trim() === lbl.trim()).length;
            const isSelected = selectedLabel.toLowerCase().trim() === lbl.toLowerCase().trim();
            const colorScheme = LABEL_COLORS[lbl.toUpperCase()] || {
              bg: 'bg-slate-800/70',
              text: 'text-emerald-300',
              border: 'border-emerald-500/30',
              glow: 'rgba(39, 196, 11, 0.2)',
            };

            return (
              <button
                key={lbl}
                onClick={() => setSelectedLabel(lbl)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-slate-800 text-[#27c40b] border-[#27c40b] ring-2 ring-[#27c40b]/40 shadow-lg scale-105'
                    : `${colorScheme.bg} ${colorScheme.text} ${colorScheme.border} hover:scale-102 hover:brightness-125`
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>{lbl}</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/40 font-bold">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 rounded-2xl bg-slate-900/40 border border-slate-800 animate-pulse p-6" />
          ))}
        </div>
      ) : filteredLinks.length === 0 ? (
        /* Empty Filter Results State */
        <div className="text-center py-16 px-4 rounded-3xl bg-slate-900/30 border border-slate-800 backdrop-blur-md">
          <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">Nenhum grupo encontrado</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
            Não encontramos nenhum grupo correspondente ao rótulo ou busca selecionada.
          </p>
          <button
            onClick={() => {
              setSelectedLabel('ALL');
              setSearchQuery('');
            }}
            className="px-5 py-2.5 rounded-xl bg-[#27c40b] text-black text-xs font-bold hover:bg-emerald-400 transition"
          >
            Ver Todos os Grupos
          </button>
        </div>
      ) : (
        /* Prominent Group Action Buttons & 3D Cards List */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          {filteredLinks.map((link) => {
            const labelColor = LABEL_COLORS[link.label.toUpperCase()] || {
              bg: 'bg-emerald-500/10',
              text: 'text-[#27c40b]',
              border: 'border-[#27c40b]/30',
              glow: 'rgba(39, 196, 11, 0.25)',
            };

            const memberCount = link.activeGroup?.memberCount ?? 0;
            const groupTitle = link.activeGroup?.name || link.baseName;

            return (
              <Card3D key={link.id} glowColor={labelColor.glow} className="h-full">
                <div className="group relative h-full flex flex-col justify-between p-6 sm:p-8 rounded-2xl bg-[#0d1017]/80 border border-slate-800/80 backdrop-blur-xl hover:border-emerald-500/50 transition-all duration-300 shadow-2xl overflow-hidden">
                  {/* Subtle Accent Glow */}
                  <div className="absolute top-0 right-0 w-36 h-36 bg-[#27c40b]/10 rounded-full blur-3xl pointer-events-none group-hover:bg-[#27c40b]/20 transition-all" />

                  {/* Card Top: Identity / Rótulo & Status */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      {/* Rótulo Badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black uppercase tracking-wide border ${labelColor.bg} ${labelColor.text} ${labelColor.border}`}
                      >
                        <Tag className="w-3.5 h-3.5" />
                        {link.label}
                      </span>

                      {/* Status Indicator */}
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#27c40b]/10 text-[#27c40b] border border-[#27c40b]/30">
                        <span className="w-2 h-2 rounded-full bg-[#27c40b] animate-ping" />
                        Vagas Abertas
                      </span>
                    </div>

                    {/* Group Title */}
                    <h3 className="text-xl sm:text-2xl font-black text-white group-hover:text-emerald-300 transition-colors mb-3 leading-snug">
                      {groupTitle}
                    </h3>

                    {/* Subtitle / Custom Text */}
                    {link.customText && (
                      <p className="text-slate-200 text-sm font-medium mb-3">
                        {link.customText}
                      </p>
                    )}

                    {/* Description */}
                    {link.groupDescription && (
                      <p className="text-slate-400 text-xs sm:text-sm leading-relaxed mb-6">
                        {link.groupDescription}
                      </p>
                    )}
                  </div>

                  {/* Card Bottom: Member Info & High-Impact Action Button */}
                  <div className="mt-4 pt-5 border-t border-slate-800/80 flex flex-col gap-4">
                    {/* Live Member & Security Badge */}
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-[#27c40b]" />
                        <span className="font-bold text-slate-200">
                          {memberCount > 0 ? `${memberCount} membros ativos` : 'Grupo Oficial Dudu Rocha'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[#27c40b] font-bold">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Canal Verificado</span>
                      </div>
                    </div>

                    {/* High-Converting Action Button Row */}
                    <div className="flex items-center gap-3">
                      <a
                        href={link.redirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-2.5 py-4 px-6 rounded-xl bg-gradient-to-r from-[#27c40b] via-[#22b809] to-[#00d084] hover:brightness-110 active:scale-98 text-black font-black text-sm sm:text-base shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition duration-200 uppercase tracking-wide"
                      >
                        <span>Entrar no Grupo Agora</span>
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1.5 transition-transform" />
                      </a>

                      <button
                        onClick={() => handleCopyLink(link.slug)}
                        title="Copiar Link de Acesso"
                        className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition active:scale-95"
                      >
                        <Copy className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card3D>
            );
          })}
        </div>
      )}
    </section>
  );
}
