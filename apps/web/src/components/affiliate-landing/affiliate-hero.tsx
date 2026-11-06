'use client';

import React from 'react';
import { ArrowDown, Check, Flame, TrendingDown, Users, ShieldCheck } from 'lucide-react';
import { getThemeStyles } from './theme';

interface AffiliateHeroProps {
  authorName: string;
  authorBadge: string;
  authorImage?: string | null;
  headline: string;
  subheadline: string;
  ctaButtonText: string;
  themeColor: string;
}

export function AffiliateHero({
  authorName,
  authorBadge,
  authorImage,
  headline,
  subheadline,
  ctaButtonText,
  themeColor,
}: AffiliateHeroProps) {
  const theme = getThemeStyles(themeColor);

  const initials = authorName
    .replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'VIP';

  return (
    <header className="relative pt-28 pb-16 sm:pt-36 sm:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Subtle Architectural Grid Lines */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-0 w-full h-[1px] bg-white/[0.04]" />
        <div className="absolute top-3/4 left-0 w-full h-[1px] bg-white/[0.04]" />
        <div className="absolute top-0 left-1/4 w-[1px] h-full bg-white/[0.04]" />
        <div className="absolute top-0 right-1/4 w-[1px] h-full bg-white/[0.04]" />

        {/* Ambient Lighting Spheres */}
        <div
          className={`absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[450px] ${theme.ambientLight} rounded-full blur-[160px]`}
        />
        <div className="absolute -top-10 right-0 w-[400px] h-[400px] bg-emerald-600/10 rounded-full blur-[140px]" />
      </div>

      {/* Blueprint Framing Container */}
      <div className="relative border border-white/10 rounded-3xl p-6 sm:p-10 lg:p-12 bg-gradient-to-b from-[#0b0e16]/90 via-[#0a0d14]/90 to-[#07090e]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
        {/* Guide tags on borders */}
        <div className="absolute top-3 left-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest pointer-events-none">
          [ RADAR DE OFERTAS · {authorName.toUpperCase()} ]
        </div>
        <div className="absolute top-3 right-4 text-[10px] font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          24H LIVE MONITORING
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center pt-4">
          {/* Left Column: Typography & Action */}
          <div className="lg:col-span-7 text-center lg:text-left">
            {/* Category Pill */}
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-5`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>COMUNIDADE VIP EXCLUSIVA NO WHATSAPP</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.08] uppercase mb-6">
              {headline.includes('SECRETAS') ? (
                <>
                  RECEBA OFERTAS{' '}
                  <span className={`text-transparent bg-clip-text bg-gradient-to-r ${theme.textGlow}`}>
                    SECRETAS
                  </span>
                  , BUGS DE PREÇO E CUPONS REAIS
                </>
              ) : (
                <span className={`text-transparent bg-clip-text bg-gradient-to-r ${theme.textGlow}`}>
                  {headline}
                </span>
              )}
            </h1>

            {/* Sub-headline */}
            <p className="text-slate-300 text-sm sm:text-base lg:text-lg leading-relaxed mb-8 max-w-2xl mx-auto lg:mx-0">
              {subheadline}
            </p>

            {/* Main Glowing Action Button */}
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start mb-6">
              <a
                href="#grupos"
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r ${theme.buttonGradient} ${theme.buttonHoverGradient} text-white font-black text-sm sm:text-base uppercase tracking-wider ${theme.buttonShadow} hover:scale-105 active:scale-95 transition-all duration-200`}
              >
                <span>{ctaButtonText}</span>
                <ArrowDown className="w-5 h-5 animate-bounce" />
              </a>
            </div>

            {/* Value Guarantees */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 sm:gap-6 text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Check className="w-3.5 h-3.5 text-emerald-400" /> 100% Gratuito
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Links Verificados
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Sem Spam ou Bate-papo
              </span>
            </div>
          </div>

          {/* Right Column: Hero Profile Image / Badge */}
          <div className="lg:col-span-5 flex justify-center relative">
            <div className="relative w-full max-w-md">
              {/* Neon Backlight Behind Image */}
              <div
                className={`absolute -inset-4 bg-gradient-to-tr ${theme.buttonGradient} rounded-3xl blur-2xl opacity-40`}
              />

              {/* Framed Image / Emblem */}
              <div className="relative rounded-2xl overflow-hidden border-2 border-white/10 bg-[#0e121a] shadow-2xl">
                {authorImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={authorImage}
                    alt={authorName}
                    className="w-full aspect-[4/5] object-cover hover:scale-105 transition-transform duration-700"
                  />
                ) : (
                  <div className="w-full aspect-[4/5] flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#10141f] to-slate-950 p-8 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px]" />
                    <div
                      className={`w-28 h-28 sm:w-36 sm:h-36 rounded-3xl bg-gradient-to-tr ${theme.buttonGradient} flex items-center justify-center text-white text-4xl sm:text-5xl font-black shadow-2xl mb-4 border border-white/20`}
                    >
                      {initials}
                    </div>
                    <span className="text-xl font-black text-white uppercase tracking-wider">
                      {authorName}
                    </span>
                    <span className="text-xs font-mono text-slate-400 mt-1 uppercase">
                      COMUNIDADE VIP
                    </span>
                  </div>
                )}

                {/* Dark Gradient Overlay at Bottom */}
                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black via-black/70 to-transparent" />

                {/* Creator Label */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                  <div>
                    <div className="text-white font-black text-sm tracking-wide uppercase">
                      {authorName}
                    </div>
                    <div className="text-slate-400 text-[11px] font-mono">{authorBadge}</div>
                  </div>
                  <div className="px-2.5 py-1 rounded bg-black/80 border border-white/20 text-emerald-400 text-[10px] font-mono font-bold">
                    VERIFICADO
                  </div>
                </div>
              </div>

              {/* Floating Notification Badge */}
              <div className="absolute -top-4 -left-4 sm:-left-8 p-3 rounded-xl bg-[#0c1018]/95 border border-emerald-500/30 shadow-2xl backdrop-blur-md hidden sm:flex items-center gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Menor Preço Detectado</div>
                  <div className="text-xs font-black text-emerald-400">+ R$ 1.250,00 OFF</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Guide tag at the bottom */}
        <div className="mt-10 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-slate-500 uppercase tracking-widest">
          <span>[ COMUNIDADE OFICIAL · WHATSAPP ]</span>
          <span>ACESSO LIVRE & GRATUITO</span>
        </div>
      </div>
    </header>
  );
}
