'use client';

import React, { useState, useMemo } from 'react';
import type { AuraNicheItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { formatGroupImage } from '@afilados/shared';
import { Check, ShieldCheck, MessageCircle, Flame, ArrowRight } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

function NicheAvatarImage({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  const [hasError, setHasError] = useState(false);
  const imageSrc = useMemo(() => formatGroupImage(src), [src]);

  const initials = (alt || 'VIP')
    .replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'VIP';

  if (!hasError && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={alt}
        onError={() => setHasError(true)}
        referrerPolicy="no-referrer"
        className={className || 'w-full h-full object-cover object-top'}
      />
    );
  }

  return (
    <div className={`w-full h-full bg-gradient-to-br from-rose-500/20 via-pink-500/20 to-purple-500/20 flex items-center justify-center font-bold text-xs text-rose-500 ${className || ''}`}>
      {initials}
    </div>
  );
}

interface AuraHeroProps {
  heroImage: string;
  badgeText?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  floatingBadgeText?: string | null;
  ctaButtonText?: string | null;
  reassuranceText?: string | null;
  niches: AuraNicheItem[];
  activeNicheId: string;
  onSelectNiche: (id: string) => void;
  onOpenModal?: (niche: AuraNicheItem) => void;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
}

export const AuraHero: React.FC<AuraHeroProps> = ({
  heroImage,
  badgeText = 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
  headline = 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
  subheadline = 'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
  floatingBadgeText = 'Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos',
  ctaButtonText = 'Entrar no Grupo do WhatsApp',
  reassuranceText = '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
  niches,
  activeNicheId,
  onSelectNiche,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);
  const activeNiche = niches.find((n) => n.id === activeNicheId) || niches[0];

  return (
    <section className={`relative pt-8 pb-16 md:pt-12 md:pb-24 overflow-hidden transition-colors duration-200 ${t.bgMain}`}>
      {/* Delicate ambient glow behind the main image */}
      <div
        className={`absolute top-12 left-1/4 -translate-x-1/2 w-[600px] h-[500px] rounded-full blur-3xl pointer-events-none -z-10 ${
          t.isDark ? 'bg-rose-950/20' : 'bg-rose-200/40'
        }`}
      />
      <div
        className={`absolute top-20 right-1/4 w-[400px] h-[400px] rounded-full blur-3xl pointer-events-none -z-10 ${
          t.isDark ? 'bg-purple-950/20' : 'bg-pink-100/50'
        }`}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header: Minimalist, clear, objective */}
        <div className="max-w-3xl mx-auto text-center mb-8 md:mb-12">
          {badgeText && (
            <div className={`inline-flex items-center gap-2 px-3.5 py-1 text-xs font-semibold tracking-wide uppercase rounded-full mb-3 border ${t.badgeBg} ${t.badgeText}`}>
              <Flame className="w-3.5 h-3.5" />
              <span>{badgeText}</span>
            </div>
          )}

          <h1 className={`text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight [text-wrap:balance] leading-[1.15] ${t.textMain}`}>
            {headline}
          </h1>

          <p className={`mt-3 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto ${t.textMuted}`}>
            {subheadline}
          </p>
        </div>

        {/* Central Stage: Large Image + Circular Niche Switcher + Niche Details */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* LEFT: Full uncropped Main Image emerging from the bg + Round clickable niche icons */}
          <div className="lg:col-span-6 flex flex-col md:flex-row gap-5 items-center justify-center">
            
            {/* The MAIN LARGE IMAGE */}
            <div className="relative w-full max-w-[500px] flex items-center justify-center group">
              {/* Backlight halo glow */}
              <div
                className={`absolute inset-0 rounded-full blur-2xl -z-10 scale-95 ${
                  t.isDark ? 'bg-rose-900/20' : 'bg-rose-200/60'
                }`}
              />

              {/* Main Image with soft feathered / blended mask edges */}
              <div
                className="relative w-full overflow-hidden transition-transform duration-700 group-hover:scale-[1.01]"
                style={{
                  maskImage:
                    'radial-gradient(ellipse 94% 88% at 50% 48%, black 68%, rgba(0,0,0,0.4) 86%, transparent 100%)',
                  WebkitMaskImage:
                    'radial-gradient(ellipse 94% 88% at 50% 48%, black 68%, rgba(0,0,0,0.4) 86%, transparent 100%)',
                }}
              >
                <img
                  src={heroImage}
                  alt={headline || 'Clube de Ofertas e Preços'}
                  referrerPolicy="no-referrer"
                  className="w-full h-auto max-h-[480px] sm:max-h-[520px] object-contain drop-shadow-sm select-none"
                />

                {/* Subtle soft bottom blend overlay */}
                <div
                  className={`absolute bottom-0 inset-x-0 h-16 pointer-events-none bg-gradient-to-t ${
                    t.isDark ? 'from-[#090b10] via-[#090b10]/40 to-transparent' : 'from-[#FFF3F6] via-[#FFF3F6]/40 to-transparent'
                  }`}
                />
              </div>

              {/* Floating Live Badge */}
              {floatingBadgeText && (
                <div
                  className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full border shadow-md flex items-center gap-2 text-xs whitespace-nowrap backdrop-blur-md ${
                    t.isDark ? 'bg-slate-900/95 border-slate-700 text-slate-200' : 'bg-white/95 border-rose-200/80 text-neutral-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-bold">{floatingBadgeText}</span>
                </div>
              )}
            </div>

            {/* CIRCULAR NICHE ICONS / PHOTOS */}
            {niches.length > 0 && (
              <div className="flex md:flex-col items-center justify-center gap-3 py-2 px-2 md:py-0 w-full md:w-auto shrink-0 overflow-x-auto md:overflow-visible">
                <span className={`hidden md:block text-[10px] font-extrabold tracking-wider uppercase text-center mb-1 ${t.accentText}`}>
                  Nichos
                </span>

                {niches.map((niche) => {
                  const isActive = niche.id === activeNicheId;
                  return (
                    <button
                      key={niche.id}
                      type="button"
                      onClick={() => onSelectNiche(niche.id)}
                      className="group/circle relative flex flex-col items-center focus:outline-none transition-transform hover:scale-105 cursor-pointer"
                      title={`Selecionar: ${niche.name}`}
                      aria-label={`Selecionar grupo de ${niche.name}`}
                    >
                      {/* Round Image Button */}
                      <div
                        className={`relative w-15 h-15 sm:w-16 sm:h-16 rounded-full overflow-hidden transition-all duration-300 ${
                          isActive
                            ? `ring-3 ${t.accentRing} ring-offset-2 ${t.isDark ? 'ring-offset-slate-900' : 'ring-offset-white'} scale-110 shadow-lg`
                            : `ring-1.5 ${t.isDark ? 'ring-slate-700 opacity-60' : 'ring-rose-200 opacity-70'} hover:opacity-100`
                        }`}
                      >
                        <NicheAvatarImage
                          src={niche.image}
                          alt={niche.name}
                        />

                        {/* Active indicator check */}
                        {isActive && (
                          <div className="absolute inset-0 bg-neutral-900/30 flex items-center justify-center">
                            <Check className="w-4 h-4 text-white stroke-[3] drop-shadow-md" />
                          </div>
                        )}
                      </div>

                      {/* Short Niche Label below circle */}
                      <span
                        className={`mt-1 text-[10px] sm:text-[11px] font-semibold tracking-tight whitespace-nowrap transition-colors max-w-[70px] truncate ${
                          isActive
                            ? `${t.accentText} font-bold`
                            : `${t.textSubtle} group-hover/circle:${t.textMain}`
                        }`}
                      >
                        {niche.name.split(',')[0].split('&')[0].trim()}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

          </div>

          {/* RIGHT: Active Selected Niche Group Card */}
          {activeNiche && (
            <div className={`lg:col-span-6 flex flex-col justify-between border rounded-3xl p-6 sm:p-8 lg:p-9 shadow-lg backdrop-blur-xs transition-colors duration-200 ${t.cardBg}`}>
              <div>
                {/* Niche Category Tag */}
                <div className={`flex flex-wrap items-center justify-between gap-3 pb-4 border-b ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-emerald-500/30 shrink-0 shadow-xs">
                      <NicheAvatarImage
                        src={activeNiche.image}
                        alt={activeNiche.name}
                      />
                    </div>
                    <div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${t.accentText}`}>
                        Nicho {activeNiche.orderNumber} Selecionado
                      </span>
                      <div className={`text-xs font-semibold ${t.textMain}`}>
                        {activeNiche.categoryBadge || 'Nicho VIP'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Grupo no WhatsApp</span>
                  </div>
                </div>

                {/* Title & Description */}
                <div className="mt-5">
                  <h2 className={`text-xl sm:text-2xl font-extrabold tracking-tight leading-tight ${t.textMain}`}>
                    {activeNiche.name}
                  </h2>
                  
                  {/* Highlighted Description Box */}
                  <p className={`mt-3 text-sm sm:text-base font-semibold leading-relaxed p-4 rounded-2xl border ${t.cardSoftBg} ${t.isDark ? 'text-slate-200' : 'text-neutral-800'}`}>
                    {activeNiche.description}
                  </p>
                </div>

                {/* Popular monitored items */}
                {activeNiche.popularItems && activeNiche.popularItems.length > 0 && (
                  <div className={`mt-6 pt-5 border-t ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5 ${t.textMuted}`}>
                      <Flame className="w-3.5 h-3.5 text-rose-500" />
                      <span>O que mais postamos com super desconto:</span>
                    </h4>

                    <div className="flex flex-wrap gap-2">
                      {activeNiche.popularItems.map((item, idx) => (
                        <span
                          key={idx}
                          className={`text-xs font-medium px-3 py-1.5 rounded-xl border transition-colors ${
                            t.isDark
                              ? 'bg-slate-900 border-slate-800 text-slate-300'
                              : 'bg-white border-rose-100 text-neutral-700 shadow-2xs'
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* DIRECT CTA BUTTON */}
              <div className={`mt-8 pt-6 border-t ${t.isDark ? 'border-slate-800' : 'border-rose-100'} space-y-3`}>
                <a
                  href={activeNiche.whatsappLink || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-full flex items-center justify-center gap-2.5 px-6 py-4 text-sm font-bold rounded-2xl shadow-lg transition-all hover:scale-[1.02] active:scale-98 cursor-pointer group ${t.primaryBtnClass}`}
                >
                  <MessageCircle className="w-5 h-5 fill-current" />
                  <span>{ctaButtonText || 'Entrar no Grupo do WhatsApp'} ({activeNiche.name.split(',')[0].split('&')[0].trim()})</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </a>

                {/* Reassurance text */}
                {reassuranceText && (
                  <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] pt-1 ${t.textSubtle}`}>
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{reassuranceText}</span>
                    </span>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

      </div>
    </section>
  );
};
