'use client';

import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { getAuraThemeStyles } from './theme';

interface AuraHeaderProps {
  logoText?: string | null;
  onJoinClick?: () => void;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
  showHowItWorks?: boolean;
  showFaq?: boolean;
  showNiches?: boolean;
}

export const AuraHeader: React.FC<AuraHeaderProps> = ({
  logoText = 'CLUBE DE PREÇOS VIP',
  onJoinClick,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
  showHowItWorks = true,
  showFaq = true,
  showNiches = true,
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);

  return (
    <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-colors duration-200 ${t.headerBg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-17 flex items-center justify-between gap-6">
        {/* Brand wordmark */}
        <a
          href="#"
          className="text-sm sm:text-base font-bold tracking-tight uppercase whitespace-nowrap shrink-0 flex items-center gap-2.5 group"
        >
          <span className={`w-2.5 h-2.5 rounded-full ${t.accentDot} group-hover:scale-125 transition-transform`} />
          <span className="font-extrabold tracking-tight">{logoText || 'CLUBE DE PREÇOS VIP'}</span>
        </a>

        {/* Navigation links */}
        <nav className={`hidden md:flex items-center gap-7 text-xs sm:text-sm font-medium ${t.textMuted}`}>
          {showNiches && (
            <a href="#grupos" className={`hover:${t.accentText} transition-colors whitespace-nowrap shrink-0`}>
              Grupos por Nicho
            </a>
          )}
          {showHowItWorks && (
            <a href="#como-funciona" className={`hover:${t.accentText} transition-colors whitespace-nowrap shrink-0`}>
              Como Funciona
            </a>
          )}
          {showFaq && (
            <a href="#duvidas" className={`hover:${t.accentText} transition-colors whitespace-nowrap shrink-0`}>
              Dúvidas
            </a>
          )}
        </nav>

        {/* Primary action button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onJoinClick}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full transition-all whitespace-nowrap shrink-0 shadow-xs hover:shadow-sm cursor-pointer hover:scale-105 active:scale-95 ${t.primaryBtnClass}`}
          >
            <span>Entrar nos Grupos</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
