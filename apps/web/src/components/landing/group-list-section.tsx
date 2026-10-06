'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card3D } from './3d-card';
import {
  Users,
  Search,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  Share2,
  Copy,
  Zap,
  Tag,
  ShieldCheck,
  Flame,
  ArrowRight,
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

// Fallback demo links shown if database is empty, so landing page is never blank
const DEMO_GROUP_LINKS: PublicGroupLink[] = [
  {
    id: 'demo-1',
    slug: 'promo-vip',
    label: 'PROMO VIP',
    baseName: 'Grupo VIP de Ofertas Imperdíveis',
    customText: 'As melhores promoções de Shopee, Mercado Livre e Amazon com até 80% OFF.',
    groupDescription: 'Receba alertas diários de bugs, cupons secretos e promoções relâmpago em primeira mão!',
    groupImageBase64: null,
    clickCount: 1420,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '🔥 PROMO VIP #12',
      memberCount: 894,
    },
    redirectUrl: '/g/promo-vip',
  },
  {
    id: 'demo-2',
    slug: 'eletronicos-tech',
    label: 'ELETRÔNICOS & TECH',
    baseName: 'Clube Tech & Smartphones',
    customText: 'Smartphones, Notebooks, Hardware e Gadgets com menor preço histórico.',
    groupDescription: 'Curadoria especializada em tecnologia, hardware e eletrônicos.',
    groupImageBase64: null,
    clickCount: 980,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '⚡ TECH & GADGETS #05',
      memberCount: 742,
    },
    redirectUrl: '/g/eletronicos-tech',
  },
  {
    id: 'demo-3',
    slug: 'cupons-exclusivos',
    label: 'CUPONS EXCLUSIVOS',
    baseName: 'Central de Cupons & Descontos',
    customText: 'Cupons testados e atualizados minuto a minuto para todas as grandes lojas.',
    groupDescription: 'Economize em todas as suas compras com nossos códigos exclusivos.',
    groupImageBase64: null,
    clickCount: 2150,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '🎟️ CUPONS & DESCONTOS #18',
      memberCount: 960,
    },
    redirectUrl: '/g/cupons-exclusivos',
  },
  {
    id: 'demo-4',
    slug: 'casa-decoracao',
    label: 'CASA & DECORAÇÃO',
    baseName: 'Achadinhos de Casa & Cozinha',
    customText: 'Utensílios, eletrodomésticos e decoração com os melhores preços.',
    groupDescription: 'Tudo para deixar seu lar moderno pagando muito menos.',
    groupImageBase64: null,
    clickCount: 640,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: '🏠 CASA & STYLES #03',
      memberCount: 512,
    },
    redirectUrl: '/g/casa-decoracao',
  },
];

// Map labels to vibrant gradient accents
const LABEL_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  'PROMO VIP': {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    glow: 'rgba(245, 158, 11, 0.2)',
  },
  'ELETRÔNICOS & TECH': {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/30',
    glow: 'rgba(6, 182, 212, 0.2)',
  },
  'CUPONS EXCLUSIVOS': {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    glow: 'rgba(16, 185, 129, 0.2)',
  },
  'CASA & DECORAÇÃO': {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    glow: 'rgba(168, 85, 247, 0.2)',
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
            setLinks(DEMO_GROUP_LINKS);
            setIsUsingDemo(true);
          }
        } else {
          setLinks(DEMO_GROUP_LINKS);
          setIsUsingDemo(true);
        }
      } catch {
        setLinks(DEMO_GROUP_LINKS);
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
    toast.success('Link do grupo copiado!', {
      description: fullUrl,
    });
  };

  return (
    <section id="grupos" className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs sm:text-sm font-medium mb-4 backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <span>Central de Grupos Verificados</span>
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-4">
          Escolha seu <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Rótulo & Grupo</span>
        </h2>
        <p className="text-slate-400 text-sm sm:text-base lg:text-lg">
          Acesse grupos exclusivos filtrados por categoria de interesse. Vagas limitadas e redirecionamento inteligente automatizado.
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
            placeholder="Buscar por nome do grupo, rótulo ou assunto..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition shadow-inner backdrop-blur-xl text-sm"
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
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2 border ${
              selectedLabel === 'ALL'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/25 scale-105'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Todos os Grupos</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-white font-bold">
              {links.length}
            </span>
          </button>

          {uniqueLabels.map((lbl) => {
            const count = links.filter((l) => l.label.trim() === lbl.trim()).length;
            const isSelected = selectedLabel.toLowerCase().trim() === lbl.toLowerCase().trim();
            const colorScheme = LABEL_COLORS[lbl.toUpperCase()] || {
              bg: 'bg-slate-800/60',
              text: 'text-indigo-300',
              border: 'border-indigo-500/30',
              glow: 'rgba(99, 102, 241, 0.2)',
            };

            return (
              <button
                key={lbl}
                onClick={() => setSelectedLabel(lbl)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-slate-800 text-white border-indigo-400 ring-2 ring-indigo-500/40 shadow-lg scale-105'
                    : `${colorScheme.bg} ${colorScheme.text} ${colorScheme.border} hover:scale-102 hover:brightness-125`
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>{lbl}</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-black/30 font-bold">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
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
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition"
          >
            Ver Todos os Grupos
          </button>
        </div>
      ) : (
        /* Group Cards 3D Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {filteredLinks.map((link) => {
            const labelColor = LABEL_COLORS[link.label.toUpperCase()] || {
              bg: 'bg-indigo-500/10',
              text: 'text-indigo-400',
              border: 'border-indigo-500/30',
              glow: 'rgba(99, 102, 241, 0.2)',
            };

            const memberCount = link.activeGroup?.memberCount ?? 0;
            const groupTitle = link.activeGroup?.name || link.baseName;

            return (
              <Card3D key={link.id} glowColor={labelColor.glow} className="h-full">
                <div className="group relative h-full flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-xl hover:border-slate-700/80 transition-all duration-300 shadow-xl overflow-hidden">
                  {/* Subtle Accent Glow */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-indigo-500/15 transition-all" />

                  {/* Card Top: Identity / Rótulo & Status */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      {/* Rótulo Badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${labelColor.bg} ${labelColor.text} ${labelColor.border}`}
                      >
                        <Tag className="w-3 h-3" />
                        {link.label}
                      </span>

                      {/* Status Indicator */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        Vagas Abertas
                      </span>
                    </div>

                    {/* Group Title */}
                    <h3 className="text-xl font-bold text-white group-hover:text-indigo-300 transition-colors line-clamp-2 mb-2">
                      {groupTitle}
                    </h3>

                    {/* Subtitle / Custom Text */}
                    {link.customText && (
                      <p className="text-slate-300 text-xs sm:text-sm font-medium mb-3 line-clamp-2">
                        {link.customText}
                      </p>
                    )}

                    {/* Description */}
                    {link.groupDescription && (
                      <p className="text-slate-400 text-xs line-clamp-2 mb-4 leading-relaxed">
                        {link.groupDescription}
                      </p>
                    )}
                  </div>

                  {/* Card Bottom: Stats & CTA Action */}
                  <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col gap-4">
                    {/* Live Member & Security Badge */}
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-indigo-400" />
                        <span className="font-semibold text-slate-200">
                          {memberCount > 0 ? `${memberCount} membros` : 'Comunidade Ativa'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Verificado</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      <a
                        href={link.redirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-600/25 hover:shadow-indigo-600/40 active:scale-98 transition duration-200"
                      >
                        <span>Entrar no Grupo</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </a>

                      <button
                        onClick={() => handleCopyLink(link.slug)}
                        title="Copiar Link de Acesso"
                        className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-700 transition active:scale-95"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card3D>
            );
          })}
        </div>
      )}

      {/* Demo Notice Banner */}
      {isUsingDemo && (
        <div className="mt-12 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center max-w-xl mx-auto backdrop-blur-md">
          <p className="text-xs text-indigo-300 font-medium">
            💡 <strong>Modo Demonstrativo Ativo:</strong> Crie seus próprios links de grupos com rótulos personalizados no painel para exibi-los automaticamente aqui!
          </p>
        </div>
      )}
    </section>
  );
}
