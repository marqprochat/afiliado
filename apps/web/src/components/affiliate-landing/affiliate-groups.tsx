'use client';

import React, { useState, useMemo } from 'react';
import { ExternalLink, Copy, Users, Sparkles, Check, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { getThemeStyles } from './theme';

export interface AffiliateGroupLink {
  id: string;
  slug: string;
  label: string;
  baseName: string;
  customText: string;
  groupDescription: string | null;
  groupImageBase64: string | null;
  displayOrder: number;
  clickCount: number;
  status: string;
  memberLimit: number;
  activeGroup: {
    name: string;
    memberCount: number;
  } | null;
  redirectUrl: string;
}

interface AffiliateGroupsProps {
  groups: AffiliateGroupLink[];
  authorName: string;
  themeColor: string;
}

function GroupAvatar({
  src,
  label,
  themeColor,
}: {
  src?: string | null;
  label: string;
  themeColor: string;
}) {
  const [hasError, setHasError] = useState(false);
  const theme = getThemeStyles(themeColor);

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
        className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-2xl object-cover border-2 border-white/10 shadow-lg group-hover:border-white/30 transition-all duration-300"
      />
    );
  }

  return (
    <div
      className={`w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-2xl bg-gradient-to-br from-slate-900 via-[#131722] to-slate-900 border-2 border-white/10 flex items-center justify-center ${theme.badgeText} font-black text-lg sm:text-2xl shadow-lg transition-all duration-300`}
    >
      {initials || 'VIP'}
    </div>
  );
}

export function AffiliateGroups({ groups, authorName, themeColor }: AffiliateGroupsProps) {
  const [selectedLabel, setSelectedLabel] = useState<string>('ALL');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const theme = getThemeStyles(themeColor);

  const uniqueLabels = useMemo(() => {
    const labels = new Set<string>();
    groups.forEach((g) => {
      if (g.label) labels.add(g.label.trim());
    });
    return Array.from(labels);
  }, [groups]);

  const filtered = useMemo(() => {
    if (selectedLabel === 'ALL') return groups;
    return groups.filter(
      (g) => g.label.toLowerCase().trim() === selectedLabel.toLowerCase().trim()
    );
  }, [groups, selectedLabel]);

  const handleCopyLink = async (e: React.MouseEvent, slug: string) => {
    e.preventDefault();
    e.stopPropagation();
    const fullUrl = `${window.location.origin}/g/${slug}`;
    const ok = await copyToClipboard(fullUrl);
    if (ok) {
      setCopiedSlug(slug);
      toast.success('Link do grupo copiado!');
      setTimeout(() => setCopiedSlug(null), 2500);
    }
  };

  return (
    <section id="grupos" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
        <div>
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-3`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>DIRETÓRIO OFICIAL DE CANAIS</span>
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight">
            ESCOLHA O SEU GRUPO VIP
          </h2>
          <p className="text-slate-400 text-sm sm:text-base mt-2 max-w-2xl">
            Clique no grupo desejado para entrar gratuitamente no WhatsApp de {authorName}.
          </p>
        </div>

        {/* Filter Badges */}
        {uniqueLabels.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSelectedLabel('ALL')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                selectedLabel === 'ALL'
                  ? `bg-white text-black shadow-lg`
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/5'
              }`}
            >
              Todos ({groups.length})
            </button>
            {uniqueLabels.map((label) => (
              <button
                key={label}
                onClick={() => setSelectedLabel(label)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                  selectedLabel === label
                    ? `bg-white text-black shadow-lg`
                    : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-[#0b0e14] border border-white/10 max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white/5 mx-auto flex items-center justify-center text-slate-400">
            <Users className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white">Novos grupos sendo preparados!</h3>
          <p className="text-sm text-slate-400">
            A equipe de {authorName} está organizando as próximas salas VIP. Volte em instantes para acessar seu convite.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((group) => {
            const isCopied = copiedSlug === group.slug;
            return (
              <div
                key={group.id}
                className={`relative p-6 sm:p-7 rounded-2xl bg-[#0b0e14] border border-white/10 ${theme.cardBorderHover} transition-all duration-300 shadow-xl group flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-start gap-4 mb-4">
                    <GroupAvatar
                      src={group.groupImageBase64}
                      label={group.label || group.baseName}
                      themeColor={themeColor}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="inline-block px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider mb-1 truncate max-w-full">
                        {group.label || 'OFERTAS'}
                      </span>
                      <h3 className="text-base sm:text-lg font-bold text-white leading-snug group-hover:text-slate-100 transition truncate">
                        {group.baseName}
                      </h3>
                      {group.activeGroup && (
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 mt-1">
                          <Users className="w-3.5 h-3.5" />
                          <span>{group.activeGroup.memberCount} membros</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed mb-6 line-clamp-3">
                    {group.customText || group.groupDescription || 'Receba as melhores oportunidades e cupons deste canal em tempo real.'}
                  </p>
                </div>

                <div className="pt-4 border-t border-white/5 flex items-center gap-2">
                  <a
                    href={`/g/${group.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r ${theme.buttonGradient} ${theme.buttonHoverGradient} text-white font-black text-xs uppercase tracking-wider ${theme.buttonShadow} hover:scale-[1.02] active:scale-95 transition-all`}
                  >
                    <span>ENTRAR NO GRUPO</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={(e) => handleCopyLink(e, group.slug)}
                    title="Copiar link de convite"
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
                  >
                    {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
