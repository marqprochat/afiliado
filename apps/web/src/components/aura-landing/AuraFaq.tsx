'use client';

import React, { useState } from 'react';
import type { AuraFaqItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

interface AuraFaqProps {
  title?: string | null;
  subtitle?: string | null;
  faqs: AuraFaqItem[];
  bannerTitle?: string | null;
  bannerText?: string | null;
  bannerButtonText?: string | null;
  whatsappGeneralUrl?: string | null;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
}

export const AuraFaq: React.FC<AuraFaqProps> = ({
  title = 'Tudo o que você precisa saber sobre os grupos',
  subtitle = 'Respostas diretas e transparentes para você entrar com total tranquilidade.',
  faqs,
  bannerTitle = 'Quer entrar no Grupo Geral com todos os nichos juntos?',
  bannerText = 'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
  bannerButtonText = 'Entrar no WhatsApp Geral',
  whatsappGeneralUrl,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="duvidas" className={`py-16 md:py-24 border-t transition-colors duration-200 ${t.isDark ? 'bg-[#090b10] border-slate-800' : 'bg-rose-50/30 border-rose-100'}`}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center mb-12">
          <span className={`text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full border ${t.badgeBg} ${t.badgeText}`}>
            Dúvidas Frequentes
          </span>
          <h2 className={`mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight ${t.textMain}`}>
            {title}
          </h2>
          <p className={`mt-2 text-sm ${t.textMuted}`}>
            {subtitle}
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className={`rounded-2xl border overflow-hidden transition-all shadow-2xs ${t.cardBg}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 focus:outline-none cursor-pointer"
                  aria-expanded={isOpen}
                >
                  <span className={`text-sm sm:text-base font-bold ${t.textMain}`}>
                    {faq.question}
                  </span>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 ${
                      t.cardSoftBg
                    } ${isOpen ? `rotate-180 ${t.accentText}` : t.textSubtle}`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className={`px-5 pb-6 sm:px-6 text-xs sm:text-sm leading-relaxed border-t pt-3 ${t.textMuted} ${t.isDark ? 'border-slate-800' : 'border-rose-50'}`}>
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom invitation banner */}
        {bannerTitle && (
          <div className="mt-12 p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-rose-600 via-rose-500 to-pink-600 text-white shadow-xl shadow-rose-500/15 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-lg sm:text-xl font-bold">
                {bannerTitle}
              </h3>
              {bannerText && (
                <p className="text-xs sm:text-sm text-rose-100 mt-1 max-w-md">
                  {bannerText}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <a
                href={whatsappGeneralUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-3 rounded-full bg-white text-emerald-600 font-bold text-xs sm:text-sm shadow-md hover:bg-neutral-50 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-emerald-600" />
                <span>{bannerButtonText || 'Entrar no WhatsApp Geral'}</span>
              </a>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
