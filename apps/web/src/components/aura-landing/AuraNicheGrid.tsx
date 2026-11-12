'use client';

import React from 'react';
import type { AuraNicheItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { MessageCircle, ArrowRight, Flame } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

interface AuraNicheGridProps {
  niches: AuraNicheItem[];
  activeNicheId: string;
  onSelectNiche: (id: string) => void;
  onOpenModal: (niche: AuraNicheItem) => void;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
}

export const AuraNicheGrid: React.FC<AuraNicheGridProps> = ({
  niches,
  activeNicheId,
  onSelectNiche,
  onOpenModal,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);

  return (
    <section id="grupos" className={`py-16 md:py-24 border-t transition-colors duration-200 ${t.isDark ? 'bg-[#0b0e15] border-slate-800' : 'bg-white border-rose-100'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mx-auto text-center mb-14">
          <span className={`text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full border ${t.badgeBg} ${t.badgeText}`}>
            Escolha Seus Grupos de Preço Favoritos
          </span>
          <h2 className={`mt-3 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ${t.textMain}`}>
            Cada grupo é focado em um nicho específico para você economizar
          </h2>
          <p className={`mt-3 text-sm sm:text-base max-w-2xl mx-auto ${t.textMuted}`}>
            Clique na foto ou no botão do WhatsApp para entrar instantaneamente no grupo do seu interesse.
          </p>
        </div>

        {/* Niche Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {niches.map((niche) => {
            const isActive = niche.id === activeNicheId;
            return (
              <div
                key={niche.id}
                className={`relative rounded-3xl p-6 sm:p-8 border transition-all duration-300 flex flex-col justify-between ${
                  isActive
                    ? `${t.cardBg} ${t.isDark ? 'border-rose-500/50 ring-2 ring-rose-500/30' : 'border-rose-400 ring-2 ring-rose-200'} shadow-xl`
                    : `${t.cardBg} ${t.isDark ? 'border-slate-800 hover:border-slate-700' : 'border-rose-100 hover:border-rose-300'} shadow-md hover:-translate-y-1`
                }`}
              >
                <div>
                  {/* Top Row: Round Clickable Photo + Niche Identity */}
                  <div className="flex items-start gap-4 mb-4">
                    <button
                      type="button"
                      onClick={() => onSelectNiche(niche.id)}
                      className={`group/photo relative w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden ring-2 transition-all shrink-0 cursor-pointer shadow-md ${
                        t.isDark ? 'ring-slate-700 hover:ring-rose-500' : 'ring-rose-300 hover:ring-rose-500'
                      }`}
                      title={`Destacar ${niche.name}`}
                    >
                      <img
                        src={niche.image}
                        alt={niche.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-top group-hover/photo:scale-110 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-neutral-950/10 group-hover/photo:bg-transparent transition-colors" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider mb-1 ${t.accentText}`}>
                        <span>Grupo {niche.orderNumber}</span>
                        <span>·</span>
                        <span>{niche.categoryBadge}</span>
                      </div>
                      
                      <h3
                        onClick={() => onSelectNiche(niche.id)}
                        className={`text-lg sm:text-xl font-extrabold cursor-pointer transition-colors leading-tight ${t.textMain} hover:${t.accentText}`}
                      >
                        {niche.name}
                      </h3>

                      <div className="flex items-center gap-2 text-xs text-neutral-500 mt-1.5">
                        <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                          <Flame className="w-3.5 h-3.5 text-rose-500" />
                          <span>+{niche.dealsTodayCount} ofertas postadas hoje</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Description Box */}
                  <div className={`my-4 p-4 rounded-2xl border text-xs sm:text-sm leading-relaxed font-medium ${t.cardSoftBg} ${t.isDark ? 'text-slate-200' : 'text-neutral-800'}`}>
                    {niche.description}
                  </div>

                  {/* Popular items monitored */}
                  {niche.popularItems && niche.popularItems.length > 0 && (
                    <div className={`mb-6 pt-3 border-t ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
                      <span className={`text-[11px] font-bold uppercase tracking-wider block mb-2 ${t.textSubtle}`}>
                        O que mais postamos com super desconto:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {niche.popularItems.map((item, i) => (
                          <span
                            key={i}
                            className={`text-[11px] px-2.5 py-1 rounded-lg border ${
                              t.isDark
                                ? 'bg-slate-900 border-slate-800 text-slate-300'
                                : 'bg-white border-rose-100 text-neutral-700'
                            }`}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Actions: Clickable WhatsApp Button and Details Link */}
                <div className={`pt-4 border-t ${t.isDark ? 'border-slate-800' : 'border-rose-100'} space-y-2.5`}>
                  <a
                    href={niche.whatsappLink || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`w-full flex items-center justify-center gap-2 px-5 py-3.5 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-md hover:scale-[1.01] active:scale-98 cursor-pointer ${t.primaryBtnClass}`}
                  >
                    <MessageCircle className="w-4 h-4 fill-current" />
                    <span>Entrar no Grupo do WhatsApp</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectNiche(niche.id);
                      onOpenModal(niche);
                    }}
                    className={`w-full py-1 text-[11px] font-semibold text-center flex items-center justify-center gap-1 hover:underline cursor-pointer ${t.accentText}`}
                  >
                    <span>Ver detalhes do grupo & link de convite</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
