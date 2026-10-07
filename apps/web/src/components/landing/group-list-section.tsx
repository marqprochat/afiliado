'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ExternalLink,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

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

// Fallback demo links abrangendo várias categorias
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

// Componente para Foto Grande do Grupo
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

  // Formatar src para garantir data uri se for base64 puro
  const imageSrc = useMemo(() => {
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    return `data:image/jpeg;base64,${src}`;
  }, [src]);

  const initials = (label || 'G')
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
        className={`${className} shrink-0 rounded-2xl object-cover border-2 border-slate-700/80 shadow-md group-hover:border-[#25D366] transition-all duration-200`}
      />
    );
  }

  return (
    <div
      className={`${className} shrink-0 rounded-2xl bg-gradient-to-br from-emerald-600/30 to-slate-800 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black text-lg sm:text-2xl shadow-md group-hover:scale-105 group-hover:border-[#25D366] transition-all duration-200`}
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

  const handleCopyLink = async (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}/g/${slug}`;
    await copyToClipboard(fullUrl);
    toast.success('Link de convite copiado!');
  };

  return (
    <section id="grupos" className="py-8 px-4 sm:px-6 max-w-4xl mx-auto scroll-mt-20">
      {/* Box Principal Estilo Canaltech Ofertas */}
      <div className="bg-[#12151c] border border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl">
        
        {/* Título de chamada */}
        <div className="text-center mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-3xl font-extrabold text-white mb-2">
            🤑 Escolha os grupos que deseja entrar:
          </h2>
          <p className="text-slate-400 text-sm sm:text-base">
            Clique no botão do grupo para receber as ofertas e cupons diretamente no seu WhatsApp:
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

        {/* Lista de Botões Diretos de Grupos com Imagem Grande e Descrição */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-900/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            Nenhum grupo encontrado nesta categoria.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredLinks.map((link) => {
              const description = link.groupDescription || link.customText;
              return (
                <a
                  key={link.id}
                  href={link.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative flex items-center justify-between p-4 sm:p-5 rounded-2xl bg-[#181d28] hover:bg-[#202738] border border-slate-700/70 hover:border-[#25D366] transition-all duration-150 shadow-md hover:shadow-xl hover:shadow-[#25D366]/10"
                >
                  {/* Lado Esquerdo: Foto Grande + Identidade/Rótulo + Descrição */}
                  <div className="flex-1 min-w-0 flex items-center gap-4 sm:gap-5 pr-3 sm:pr-6">
                    <GroupAvatar
                      src={link.groupImageBase64}
                      label={link.label}
                      className="w-14 h-14 sm:w-20 sm:h-20 shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-xl font-bold text-white group-hover:text-[#25D366] transition-colors leading-snug break-words">
                        {link.label}
                      </h3>
                      {description && (
                        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mt-1 line-clamp-2">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Lado Direito: Botão "Entrar" e Copiar */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => handleCopyLink(e, link.slug)}
                      title="Copiar link de convite"
                      className="hidden sm:flex p-3 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    <div className="px-4 py-3 sm:px-6 sm:py-3.5 rounded-xl bg-[#25D366] text-black font-extrabold text-xs sm:text-base group-hover:bg-[#22c35e] group-hover:scale-105 transition-all flex items-center gap-2 shadow-lg shadow-[#25D366]/20 shrink-0 uppercase tracking-wide">
                      <span>Entrar</span>
                      <ExternalLink className="w-4 h-4" />
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* Rodapé simples do box */}
        <div className="mt-8 pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <span>🔒 Todos os grupos são 100% gratuitos e livres de spam</span>
          <span>⚡ Links com vagas verificadas e redirecionamento automático</span>
        </div>
      </div>
    </section>
  );
}
