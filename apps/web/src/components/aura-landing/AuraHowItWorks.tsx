'use client';

import React from 'react';
import type { AuraStepItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { Search, ShieldCheck, Zap, BellOff } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

interface AuraHowItWorksProps {
  title?: string | null;
  subtitle?: string | null;
  steps: AuraStepItem[];
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
}

export const AuraHowItWorks: React.FC<AuraHowItWorksProps> = ({
  title = 'Como funcionam os nossos grupos de preço',
  subtitle = 'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
  steps,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);

  const icons = [Search, ShieldCheck, Zap];

  return (
    <section id="como-funciona" className={`py-16 md:py-24 border-t transition-colors duration-200 ${t.sectionBgAlt}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="max-w-3xl mx-auto text-center mb-14">
          <span className={`text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full border ${t.badgeBg} ${t.badgeText}`}>
            Praticidade & Segurança
          </span>
          <h2 className={`mt-3 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ${t.textMain}`}>
            {title}
          </h2>
          <p className={`mt-3 text-sm sm:text-base max-w-2xl mx-auto ${t.textMuted}`}>
            {subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step, idx) => {
            const Icon = icons[idx % icons.length] || Search;
            return (
              <div
                key={step.number || idx}
                className={`p-8 rounded-3xl border shadow-sm flex flex-col justify-between transition-all hover:-translate-y-1 ${t.cardBg}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className={`font-mono text-3xl font-black ${t.isDark ? 'text-slate-700' : 'text-rose-200'}`}>
                      {step.number}
                    </span>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${t.cardSoftBg} ${t.accentText}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>

                  <h3 className={`text-lg font-bold mb-2.5 ${t.textMain}`}>
                    {step.title}
                  </h3>

                  <p className={`text-xs sm:text-sm leading-relaxed ${t.textMuted}`}>
                    {step.description}
                  </p>
                </div>

                <div className={`mt-6 pt-4 border-t ${t.isDark ? 'border-slate-800' : 'border-rose-100'} flex items-center gap-1.5 text-[11px] font-semibold ${t.accentText}`}>
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Grupo 100% silencioso e organizado</span>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
