'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  ExternalLink,
  Tag,
  CheckCircle,
  Share2,
  Copy,
  Users,
  Smartphone,
  Laptop,
  Flame,
  Ticket,
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

// Fallback demo links shown if database is empty
const DUDU_ROCHA_DEMO_LINKS: PublicGroupLink[] = [
  {
    id: 'dudu-1',
    slug: 'dudu-ofertas-vip',
    label: 'Todas as Ofertas',
    baseName: 'Grupo VIP de Ofertas Dudu Rocha',
    customText: 'Smartphones, tecnologia, eletrônicos e bugs de preço com desconto real.',
    groupDescription: 'Notificações diárias das melhores ofertas da internet.',
    groupImageBase64: null,
    clickCount: 5430,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: 'Grupo VIP de Ofertas Dudu Rocha #14',
      memberCount: 940,
    },
    redirectUrl: '/g/dudu-ofertas-vip',
  },
  {
    id: 'dudu-2',
    slug: 'dudu-smartphones',
    label: 'Celulares e Smartphones',
    baseName: 'Ofertas de Celulares & Smartphones',
    customText: 'Samsung Galaxy, iPhones, Xiaomi e Motorola pelo menor preço histórico.',
    groupDescription: 'Monitore quedas de preço e lançamentos com links 100% confiáveis.',
    groupImageBase64: null,
    clickCount: 3820,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: 'Ofertas de Celulares Dudu Rocha #08',
      memberCount: 885,
    },
    redirectUrl: '/g/dudu-smartphones',
  },
  {
    id: 'dudu-3',
    slug: 'dudu-notebooks',
    label: 'Notebook e Informática',
    baseName: 'Notebooks, PCs e Periféricos',
    customText: 'Laptops de trabalho, MacBooks, monitores e periféricos com cupons.',
    groupDescription: 'Compre o melhor notebook para suas necessidades com desconto.',
    groupImageBase64: null,
    clickCount: 2950,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: 'Notebooks & Informática Dudu Rocha #04',
      memberCount: 790,
    },
    redirectUrl: '/g/dudu-notebooks',
  },
  {
    id: 'dudu-4',
    slug: 'dudu-cupons',
    label: 'Cupons e Descontos',
    baseName: 'Cupons Secretos & Descontos Relâmpago',
    customText: 'Cupons de Mercado Livre, Shopee, Amazon, Magalu e KaBuM.',
    groupDescription: 'Códigos promocionais testados minuto a minuto.',
    groupImageBase64: null,
    clickCount: 6810,
    status: 'ACTIVE',
    memberLimit: 1000,
    activeGroup: {
      name: 'Cupons & Descontos Dudu Rocha #22',
      memberCount: 982,
    },
    redirectUrl: '/g/dudu-cupons',
  },
];

// Helper component for group avatar image
function GroupAvatar({
  src,
  label,
  className = 'w-12 h-12',
}: {
  src?: string | null;
  label: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  // Formatar src para garantir data uri se for base64 puro
  const imageSrc = useMemo(() => {
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    return `data:image/jpeg;base64,${src}`;
  }, [src]);

  const initials = (label || 'G')
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
        className={`${className} shrink-0 rounded-xl sm:rounded-2xl object-cover border border-slate-700/80 shadow-md group-hover:border-[#25D366] transition-all duration-200`}
      />
    );
  }

  return (
    <div
      className={`${className} shrink-0 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-600/30 to-slate-800 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-extrabold text-sm sm:text-base shadow-md group-hover:scale-105 group-hover:border-[#25D366] transition-all duration-200`}
    >
      {initials}
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

  // Extrai rótulos únicos
  const uniqueLabels = useMemo(() => {
    const labels = new Set<string>();
    links.forEach((link) => {
      if (link.label) labels.add(link.label.trim());
    });
    return Array.from(labels);
  }, [links]);

  // Filtra por categoria/rótulo selecionado
  const filteredLinks = useMemo(() => {
    if (selectedLabel === 'ALL') return links;
    return links.filter(
      (link) => link.label.toLowerCase().trim() === selectedLabel.toLowerCase().trim()
    );
  }, [links, selectedLabel]);

  const handleCopyLink = (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}/g/${slug}`;
    navigator.clipboard.writeText(fullUrl);
    toast.success('Link de convite copiado!');
  };

  return (
    <section id="grupos" className="py-8 px-4 sm:px-6 max-w-4xl mx-auto">
      {/* Box Principal Estilo Canaltech Ofertas */}
      <div className="bg-[#12151c] border border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl">
        
        {/* Título de chamada */}
        <div className="text-center mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
            🤑 Escolha o grupo que deseja acompanhar:
          </h2>
          <p className="text-slate-400 text-sm">
            Selecione a categoria de ofertas abaixo para entrar diretamente pelo WhatsApp:
          </p>
        </div>

        {/* Filtro Rápido de Categorias / Rótulos */}
        {uniqueLabels.length > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6 sm:mb-8">
            <button
              onClick={() => setSelectedLabel('ALL')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition border ${
                selectedLabel === 'ALL'
                  ? 'bg-[#25D366] text-black border-[#25D366] font-bold shadow-md'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
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
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition border ${
                    isSelected
                      ? 'bg-[#25D366] text-black border-[#25D366] font-bold shadow-md'
                      : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {lbl} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Lista de Botões Diretos de Grupos */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-900/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            Nenhum grupo encontrado nesta categoria.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredLinks.map((link) => {
              return (
                <a
                  key={link.id}
                  href={link.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-[#1a1f2c] hover:bg-[#202738] border border-slate-700/80 hover:border-[#25D366] transition-all duration-150 shadow-md hover:shadow-lg hover:shadow-[#25D366]/10"
                >
                  {/* Lado Esquerdo: Foto do Grupo + Identidade/Rótulo */}
                  <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 pr-2">
                    <GroupAvatar
                      src={link.groupImageBase64}
                      label={link.label}
                      className="w-11 h-11 sm:w-12 sm:h-12"
                    />

                    <div className="min-w-0">
                      <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-[#25D366] transition-colors truncate">
                        {link.label}
                      </h3>
                      {link.customText && (
                        <p className="text-xs text-slate-400 truncate mt-0.5 hidden sm:block">
                          {link.customText}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Lado Direito: Botão "Entrar" e Copiar */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => handleCopyLink(e, link.slug)}
                      title="Copiar link de convite"
                      className="hidden sm:flex p-2.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    <div className="px-4 py-2.5 rounded-lg bg-[#25D366] text-black font-extrabold text-xs sm:text-sm group-hover:bg-[#22c35e] group-hover:scale-105 transition-all flex items-center gap-1.5 shadow">
                      <span>Entrar</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* Rodapé simples do box */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <span>🔒 Todos os grupos são 100% gratuitos e verificados</span>
          <span>⚡ Redirecionamento automático com vagas ativas</span>
        </div>
      </div>
    </section>
  );
}
