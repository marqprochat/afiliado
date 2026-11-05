'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ExternalLink,
  Copy,
  Users,
  Sparkles,
  ShieldCheck,
  Zap,
  Flame,
} from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

export interface PublicGroupLink {
  id: string;
  slug: string;
  label: string;
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

const DUDU_ROCHA_DEMO_LINKS: PublicGroupLink[] = [
  {
    id: 'dudu-1',
    slug: 'dudu-ofertas-vip',
    label: '🔥 Todas as Ofertas & Bugs',
    baseName: 'Grupo VIP Geral Dudu Rocha',
    customText: 'Acompanhe em tempo real os maiores descontos, erros de preço e cupons de todas as lojas.',
    groupDescription: 'Acompanhe em tempo real os maiores descontos, erros de preço e cupons de todas as lojas.',
    groupImageBase64: null,
    clickCount: 5430,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: null,
    redirectUrl: '/g/dudu-ofertas-vip',
  },
  {
    id: 'dudu-2',
    slug: 'dudu-smartphones',
    label: '📱 Celulares & Smartphones',
    baseName: 'Ofertas de Celulares & Smartphones',
    customText: 'Samsung Galaxy, iPhones, Xiaomi e Motorola com o menor preço histórico e cupons.',
    groupDescription: 'Samsung Galaxy, iPhones, Xiaomi e Motorola com o menor preço histórico e cupons.',
    groupImageBase64: null,
    clickCount: 3820,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: null,
    redirectUrl: '/g/dudu-smartphones',
  },
  {
    id: 'dudu-3',
    slug: 'dudu-cupons',
    label: '🏷️ Cupons & Descontos Secretos',
    baseName: 'Cupons Secretos & Descontos Relâmpago',
    customText: 'Cupons exclusivos de Mercado Livre, Amazon, Shopee, Magalu e KaBuM testados diariamente.',
    groupDescription: 'Cupons exclusivos de Mercado Livre, Amazon, Shopee, Magalu e KaBuM testados diariamente.',
    groupImageBase64: null,
    clickCount: 6810,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: null,
    redirectUrl: '/g/dudu-cupons',
  },
  {
    id: 'dudu-4',
    slug: 'dudu-notebooks',
    label: '💻 Notebooks & Informática',
    baseName: 'Notebooks, PCs e Periféricos',
    customText: 'Laptops para trabalho e estudo, monitores, MacBooks e periféricos com super desconto.',
    groupDescription: 'Laptops para trabalho e estudo, monitores, MacBooks e periféricos com super desconto.',
    groupImageBase64: null,
    clickCount: 2950,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: null,
    redirectUrl: '/g/dudu-notebooks',
  },
  {
    id: 'dudu-5',
    slug: 'dudu-casa-eletro',
    label: '🏠 Casa, Cozinha & Eletro',
    baseName: 'Casa e Eletrodomésticos',
    customText: 'Air fryers, aspiradores robô, geladeiras, TVs e itens essenciais para sua casa.',
    groupDescription: 'Air fryers, aspiradores robô, geladeiras, TVs e itens essenciais para sua casa.',
    groupImageBase64: null,
    clickCount: 2120,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: null,
    redirectUrl: '/g/dudu-casa-eletro',
  },
];

function GroupAvatar({
  src,
  label,
  className = 'w-16 h-16 sm:w-20 sm:h-20',
}: {
  src?: string | null;
  label: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  const imageSrc = useMemo(() => {
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    return `data:image/jpeg;base64,${src}`;
  }, [src]);

  const initials = (label || 'VIP')
    .replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (imageSrc && !hasError) {
    return (
      <img
        src={imageSrc}
        alt={label}
        onError={() => setHasError(true)}
        className={`${className} shrink-0 rounded-2xl object-cover border-2 border-white/10 shadow-lg group-hover:border-red-500/60 transition-all duration-300`}
      />
    );
  }

  return (
    <div
      className={`${className} shrink-0 rounded-2xl bg-gradient-to-br from-red-950/40 via-[#131722] to-slate-900 border-2 border-white/10 flex items-center justify-center text-red-400 font-black text-lg sm:text-2xl shadow-lg group-hover:border-red-500/60 transition-all duration-300`}
    >
      {initials || 'VIP'}
    </div>
  );
}

export function GroupListSection() {
  const [links, setLinks] = useState<PublicGroupLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLabel, setSelectedLabel] = useState<string>('ALL');

  useEffect(() => {
    async function fetchPublicGroups() {
      try {
        const res = await fetch('/api/v1/public/group-links');
        if (res.ok) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
            setLinks(json.data);
          } else {
            setLinks(DUDU_ROCHA_DEMO_LINKS);
          }
        } else {
          setLinks(DUDU_ROCHA_DEMO_LINKS);
        }
      } catch {
        setLinks(DUDU_ROCHA_DEMO_LINKS);
      } finally {
        setLoading(false);
      }
    }

    fetchPublicGroups();
  }, []);

  const uniqueLabels = useMemo(() => {
    const labels = new Set<string>();
    links.forEach((link) => {
      if (link.label) labels.add(link.label.trim());
    });
    return Array.from(labels);
  }, [links]);

  const filteredLinks = useMemo(() => {
    if (selectedLabel === 'ALL') return links;
    return links.filter(
      (link) => link.label.toLowerCase().trim() === selectedLabel.toLowerCase().trim()
    );
  }, [links, selectedLabel]);

  const handleCopyLink = async (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}/g/${slug}`;
    await copyToClipboard(fullUrl);
    toast.success('Link de convite copiado com sucesso!');
  };

  return (
    <section id="grupos" className="py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto scroll-mt-20">
      {/* Container Principal Estilo Blueprint / Launch Page */}
      <div className="relative bg-[#090c12] border border-white/10 rounded-3xl p-6 sm:p-10 shadow-2xl overflow-hidden">
        {/* Glow corner */}
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-12 relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
            <span>[ DIRETÓRIO DE LINKS ATIVOS ]</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight uppercase mb-3">
            ESCOLHA SEU GRUPO VIP
          </h2>
          <p className="text-slate-400 text-sm sm:text-base">
            Selecione a categoria desejada e receba cupons secretos e promoções em tempo real no seu WhatsApp:
          </p>
        </div>

        {/* Filter Tabs */}
        {uniqueLabels.length > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-8 relative z-10">
            <button
              onClick={() => setSelectedLabel('ALL')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wide transition border ${
                selectedLabel === 'ALL'
                  ? 'bg-red-600 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                  : 'bg-[#111622] text-slate-300 border-white/10 hover:bg-[#182030] hover:text-white'
              }`}
            >
              Todos ({links.length})
            </button>

            {uniqueLabels.map((lbl) => {
              const isSelected = selectedLabel.toLowerCase().trim() === lbl.toLowerCase().trim();
              const count = links.filter((l) => l.label.trim() === lbl.trim()).length;
              return (
                <button
                  key={lbl}
                  onClick={() => setSelectedLabel(lbl)}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wide transition border ${
                    isSelected
                      ? 'bg-red-600 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                      : 'bg-[#111622] text-slate-300 border-white/10 hover:bg-[#182030] hover:text-white'
                  }`}
                >
                  {lbl} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Link Cards List */}
        {loading ? (
          <div className="space-y-4 relative z-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-[#131824] rounded-2xl animate-pulse border border-white/5" />
            ))}
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm relative z-10">
            Nenhum grupo encontrado nesta categoria no momento.
          </div>
        ) : (
          <div className="flex flex-col gap-4 relative z-10">
            {filteredLinks.map((link) => {
              const description = link.groupDescription || link.customText;
              return (
                <div
                  key={link.id}
                  className="group relative flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-5 rounded-2xl bg-[#0e121a] hover:bg-[#131926] border border-white/10 hover:border-red-500/50 transition-all duration-200 shadow-xl"
                >
                  {/* Left: Avatar + Details */}
                  <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1 mb-4 sm:mb-0 pr-0 sm:pr-4">
                    <GroupAvatar
                      src={link.groupImageBase64}
                      label={link.label}
                      className="w-14 h-14 sm:w-16 sm:h-16 shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Vagas Abertas
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-black text-white group-hover:text-red-400 transition-colors leading-snug">
                        {link.label}
                      </h3>
                      {description && (
                        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mt-1 line-clamp-2">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end shrink-0">
                    <button
                      onClick={(e) => handleCopyLink(e, link.slug)}
                      title="Copiar link de convite"
                      className="p-3 rounded-xl bg-[#161c27] text-slate-400 hover:text-white hover:bg-[#20293a] border border-white/5 transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    <a
                      href={link.redirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-[0_0_20px_rgba(239,68,68,0.35)] group-hover:scale-105 transition-all duration-150"
                    >
                      <span>Entrar no Grupo</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Technical Footer of Box */}
        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3 relative z-10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Todos os grupos são 100% gratuitos e livres de spam</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Links com rotação inteligente de vagas ativas</span>
          </div>
        </div>
      </div>
    </section>
  );
}
