'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Flame } from 'lucide-react';
import { getThemeStyles } from './theme';

interface AffiliateNavProps {
  logoText: string;
  themeColor: string;
  showBenefits?: boolean;
  showAuthority?: boolean;
  showCategories?: boolean;
  showFaq?: boolean;
}

export function AffiliateNav({
  logoText,
  themeColor,
  showBenefits = true,
  showAuthority = true,
  showCategories = true,
  showFaq = true,
}: AffiliateNavProps) {
  const theme = getThemeStyles(themeColor);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#07090e]/90 backdrop-blur-xl border-b border-white/10 py-3 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Brand Logo & Authority Label */}
        <div className="flex items-center gap-3">
          <div className="relative h-10 px-3 py-1 bg-black/90 rounded-xl flex items-center gap-2.5 border border-white/10 shadow-inner">
            <span className="text-sm font-black text-white tracking-tight uppercase">
              {logoText}
            </span>
            <div className="h-3.5 w-[1px] bg-white/20" />
            <span
              className={`px-2 py-0.5 rounded-md ${theme.badgeBg} ${theme.badgeText} text-[10px] sm:text-[11px] font-black tracking-widest uppercase border ${theme.badgeBorder}`}
            >
              VIP
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Radar 24h Ativo</span>
          </div>
        </div>

        {/* Quick Nav Anchors */}
        <nav className="hidden md:flex items-center gap-6 text-xs uppercase tracking-wider font-bold text-slate-300">
          {showBenefits && (
            <a href="#para-quem" className="hover:text-white transition">
              Para Quem É
            </a>
          )}
          {showAuthority && (
            <a href="#quem-somos" className="hover:text-white transition">
              Autoridade
            </a>
          )}
          {showCategories && (
            <a href="#categorias" className="hover:text-white transition">
              Categorias
            </a>
          )}
          {showFaq && (
            <a href="#faq" className="hover:text-white transition">
              Dúvidas
            </a>
          )}
        </nav>

        {/* Action Button */}
        <div className="flex items-center gap-3">
          <a
            href="#grupos"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r ${theme.buttonGradient} ${theme.buttonHoverGradient} text-white text-xs font-black uppercase tracking-wider transition-all duration-150 ${theme.buttonShadow} hover:scale-105 active:scale-95`}
          >
            <span>Entrar nos Grupos</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
