'use client';

import React, { useState } from 'react';
import type { AuraNicheItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { X, MessageCircle, Copy, CheckCheck, Flame, ArrowRight } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

interface AuraGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  niche: AuraNicheItem | null;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
}

export const AuraGroupModal: React.FC<AuraGroupModalProps> = ({
  isOpen,
  onClose,
  niche,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);

  if (!isOpen || !niche) return null;

  const handleCopy = (link: string) => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`relative w-full max-w-lg rounded-3xl shadow-2xl border overflow-hidden flex flex-col ${t.cardBg}`}
        role="dialog"
        aria-modal="true"
      >
        {/* Header with Niche Photo and Close */}
        <div className={`p-6 border-b flex items-center justify-between ${t.cardSoftBg} ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
          <div className="flex items-center gap-3.5">
            <div className={`w-14 h-14 rounded-full overflow-hidden ring-3 shadow-md shrink-0 ${t.accentRing}`}>
              <img
                src={niche.image}
                alt={niche.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover object-top"
              />
            </div>
            <div>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${t.badgeBg} ${t.badgeText}`}>
                Nicho {niche.orderNumber}
              </span>
              <h3 className={`text-lg font-bold leading-tight mt-1 ${t.textMain}`}>
                {niche.name}
              </h3>
              <p className={`text-xs ${t.textSubtle}`}>{niche.categoryBadge}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              t.isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-neutral-400 hover:text-neutral-700 hover:bg-rose-100/50'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <div className={`flex items-center justify-between text-xs p-3 rounded-2xl border ${t.cardSoftBg} ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-500">
              <MessageCircle className="w-4 h-4 fill-emerald-500" />
              <span>Grupo Oficial no WhatsApp</span>
            </span>
            <span className="flex items-center gap-1 font-semibold text-rose-500">
              <Flame className="w-4 h-4 text-rose-500" />
              <span>+{niche.dealsTodayCount} ofertas hoje</span>
            </span>
            <span className={`text-[11px] font-medium ${t.textSubtle}`}>100% Gratuito</span>
          </div>

          {/* Description */}
          <div className={`p-4 rounded-2xl border text-xs sm:text-sm leading-relaxed font-medium ${t.cardSoftBg} ${t.isDark ? 'text-slate-200' : 'text-neutral-800'}`}>
            {niche.description}
          </div>

          {/* WhatsApp Direct Action block */}
          <div className={`p-4 rounded-2xl border space-y-3 ${
            t.isDark ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-emerald-50/50 border-emerald-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${t.isDark ? 'text-emerald-300' : 'text-emerald-900'}`}>
                <MessageCircle className="w-4 h-4 text-emerald-500 fill-emerald-500" />
                <span>Link de Convite para o WhatsApp</span>
              </span>
              {niche.whatsappLink && (
                <button
                  type="button"
                  onClick={() => handleCopy(niche.whatsappLink)}
                  className="text-[11px] font-semibold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  {isCopied ? (
                    <>
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar Link</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <a
              href={niche.whatsappLink || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full flex items-center justify-center gap-2 px-5 py-3.5 text-xs sm:text-sm font-bold rounded-xl shadow-lg transition-all hover:scale-[1.01] active:scale-98 cursor-pointer ${t.primaryBtnClass}`}
            >
              <MessageCircle className="w-4 h-4 fill-current" />
              <span>Entrar no Grupo do WhatsApp Agora</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
