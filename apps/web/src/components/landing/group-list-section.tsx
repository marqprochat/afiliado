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

// WhatsApp Icon SVG component
function WhatsAppIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.78 14.15c-.24.68-1.39 1.3-1.92 1.38-.5.08-1.14.12-3.32-.78-2.6-1.08-4.27-3.72-4.4-3.89-.13-.17-1.06-1.41-1.06-2.69s.67-1.91.91-2.17c.24-.26.52-.33.7-.33.17 0 .35 0 .5.01.16.01.38-.06.59.45.22.52.75 1.83.82 1.96.07.13.11.29.02.46-.09.18-.13.29-.26.44-.13.15-.28.34-.4.46-.13.13-.27.27-.12.53.15.26.68 1.12 1.45 1.81.99.89 1.83 1.16 2.09 1.29.26.13.41.11.56-.06.15-.17.65-.76.82-1.02.17-.26.35-.22.59-.13.24.09 1.52.72 1.78.85.26.13.44.19.5.3.07.12.07.69-.17 1.37z" />
    </svg>
  );
}

export function GroupListSection() {
  const [links, setLinks] = useState<PublicGroupLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLabel, setSelectedLabel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Filtra por categoria/rótulo e busca
  const filteredLinks = useMemo(() => {
    return links.filter((link) => {
      const matchesLabel =
        selectedLabel === 'ALL' ||
        link.label.toLowerCase().trim() === selectedLabel.toLowerCase().trim();

      const matchesSearch =
        !searchQuery ||
        link.baseName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        link.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        link.customText.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesLabel && matchesSearch;
    });
  }, [links, selectedLabel, searchQuery]);

  const handleCopyLink = (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}/g/${slug}`;
    navigator.clipboard.writeText(fullUrl);
    toast.success('Link do grupo copiado!');
  };

  return (
    <section id="grupos" className="py-10 px-4 sm:px-6 max-w-4xl mx-auto">
      {/* Box Principal Estilo Canaltech Ofertas */}
      <div className="bg-[#12151c] border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        
        {/* Título de chamada */}
        <div className="text-center mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
            🤑 Escolha o grupo que deseja acompanhar:
          </h2>
          <p className="text-slate-400 text-sm">
            Clique no botão do grupo de seu interesse para entrar diretamente pelo WhatsApp
          </p>
        </div>

        {/* Filtro Rápido de Categorias / Rótulos */}
        {uniqueLabels.length > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            <button
              onClick={() => setSelectedLabel('ALL')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition border ${
                selectedLabel === 'ALL'
                  ? 'bg-[#25D366] text-black border-[#25D366] font-bold shadow-md'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Todas as Ofertas ({links.length})
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
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-900/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            Nenhum grupo encontrado nesta categoria.
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {filteredLinks.map((link) => {
              const displayName = link.activeGroup?.name || link.baseName;
              return (
                <a
                  key={link.id}
                  href={link.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative flex items-center justify-between p-4 sm:p-5 rounded-xl bg-[#1a1f2c] hover:bg-[#202738] border border-slate-700/80 hover:border-[#25D366] transition-all duration-150 shadow-md hover:shadow-lg hover:shadow-[#25D366]/10"
                >
                  {/* Lado Esquerdo: Ícone WhatsApp + Nome do Grupo / Rótulo */}
                  <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 pr-3">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#25D366]/15 border border-[#25D366]/30 flex items-center justify-center shrink-0 text-[#25D366] group-hover:scale-110 group-hover:bg-[#25D366] group-hover:text-black transition-all">
                      <WhatsAppIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-[#25D366] uppercase tracking-wide">
                          {link.label}
                        </span>
                        {link.activeGroup?.memberCount ? (
                          <span className="text-[11px] text-slate-400">
                            · {link.activeGroup.memberCount} membros
                          </span>
                        ) : null}
                      </div>

                      <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-[#25D366] transition-colors truncate">
                        {displayName}
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
                      title="Copiar link do grupo"
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

        {/* Nota de rodapé simples do box */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <span>🔒 Todos os grupos são gratuitos e livres de spam</span>
          <span>⚡ Redirecionamento automático com vagas ativas</span>
        </div>
      </div>
    </section>
  );
}
