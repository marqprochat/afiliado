'use client';

import React from 'react';
import type { ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import { ShieldCheck, MessageCircle, Heart } from 'lucide-react';
import { getAuraThemeStyles } from './theme';

interface AuraFooterProps {
  logoText?: string | null;
  footerText?: string | null;
  whatsappGeneralUrl?: string | null;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;
  showHowItWorks?: boolean;
  showFaq?: boolean;
  showNiches?: boolean;
}

export const AuraFooter: React.FC<AuraFooterProps> = ({
  logoText = 'CLUBE DE PREÇOS VIP',
  footerText = 'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',
  whatsappGeneralUrl,
  themeColor = 'rose',
  themeMode = 'light',
  buttonColor = 'emerald',
  showHowItWorks = true,
  showFaq = true,
  showNiches = true,
}) => {
  const t = getAuraThemeStyles(themeColor, themeMode, buttonColor);

  return (
    <footer className={`border-t py-12 text-xs transition-colors duration-200 ${t.footerBg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b ${t.isDark ? 'border-slate-800' : 'border-rose-100'}`}>
          <div>
            <div className={`flex items-center gap-2 text-base font-extrabold tracking-tight uppercase ${t.textMain}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${t.accentDot}`} />
              <span>{logoText || 'CLUBE DE PREÇOS VIP'}</span>
            </div>
            {footerText && (
              <p className={`mt-1.5 text-xs max-w-md ${t.textMuted}`}>
                {footerText}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs">
            {showNiches && (
              <a href="#grupos" className={`hover:${t.accentText} transition-colors`}>
                Grupos por Nicho
              </a>
            )}
            {showHowItWorks && (
              <a href="#como-funciona" className={`hover:${t.accentText} transition-colors`}>
                Como Funciona
              </a>
            )}
            {showFaq && (
              <a href="#duvidas" className={`hover:${t.accentText} transition-colors`}>
                Perguntas Frequentes
              </a>
            )}
            {whatsappGeneralUrl && (
              <a
                href={whatsappGeneralUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-emerald-500 hover:text-emerald-400 font-semibold"
              >
                <MessageCircle className="w-3.5 h-3.5 fill-current" />
                <span>WhatsApp Geral</span>
              </a>
            )}
          </div>
        </div>

        <div className={`pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] ${t.textSubtle}`}>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className={`w-3.5 h-3.5 ${t.accentText}`} />
            <span>© {new Date().getFullYear()} {logoText || 'Clube de Preços VIP'}. Todos os direitos reservados.</span>
          </div>

          <div className="flex items-center gap-1">
            <span>Feito com</span>
            <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
            <span>para quem ama economizar</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
