'use client';

import React from 'react';
import { Youtube, Instagram, Send, ShieldCheck } from 'lucide-react';
import { getThemeStyles } from './theme';

interface AffiliateAuthorityProps {
  authorName: string;
  authorBio?: string | null;
  stat1Value?: string | null;
  stat1Label?: string | null;
  stat2Value?: string | null;
  stat2Label?: string | null;
  stat3Value?: string | null;
  stat3Label?: string | null;
  stat4Value?: string | null;
  stat4Label?: string | null;
  youtubeUrl?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  themeColor: string;
}

export function AffiliateAuthority({
  authorName,
  authorBio,
  stat1Value,
  stat1Label,
  stat2Value,
  stat2Label,
  stat3Value,
  stat3Label,
  stat4Value,
  stat4Label,
  youtubeUrl,
  instagramUrl,
  telegramUrl,
  themeColor,
}: AffiliateAuthorityProps) {
  const theme = getThemeStyles(themeColor);

  return (
    <section id="quem-somos" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-4`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>TRANSPARÊNCIA & CREDIBILIDADE</span>
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight mb-6">
            GARIMPANDO AS MELHORES OPORTUNIDADES DA INTERNET PRA VOCÊ.
          </h2>
          <div className="space-y-4 text-slate-300 text-sm sm:text-base leading-relaxed">
            <p>
              {authorBio ||
                `Nossa missão é combater a falsa sensação de desconto. Em vez de promoções maquiadas, monitoramos os preços em tempo real com ferramentas automatizadas para alertar nossa comunidade exatamente no momento em que os preços despencam.`}
            </p>
            <p className="text-white font-bold">
              Todos os links recomendados nos nossos grupos são conferidos e direcionam com exclusividade para as lojas oficiais e confiáveis do país.
            </p>
          </div>

          {/* Social Links */}
          {(youtubeUrl || instagramUrl || telegramUrl) && (
            <div className="flex flex-wrap items-center gap-3 pt-6 mt-6 border-t border-white/10">
              <span className="text-xs font-mono uppercase text-slate-400 mr-2">Siga nas redes:</span>
              {youtubeUrl && (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition"
                >
                  <Youtube className="w-4 h-4 text-red-500" />
                  <span>YouTube</span>
                </a>
              )}
              {instagramUrl && (
                <a
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition"
                >
                  <Instagram className="w-4 h-4 text-pink-500" />
                  <span>Instagram</span>
                </a>
              )}
              {telegramUrl && (
                <a
                  href={telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition"
                >
                  <Send className="w-4 h-4 text-sky-400" />
                  <span>Telegram</span>
                </a>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 grid grid-cols-2 gap-4">
          <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
            <div className="text-3xl sm:text-4xl font-black text-white mb-1">
              {stat1Value || '+10K'}
            </div>
            <div className="text-xs font-mono text-slate-400 uppercase">
              {stat1Label || 'Membros VIP'}
            </div>
          </div>
          <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
            <div className="text-3xl sm:text-4xl font-black text-emerald-400 mb-1">
              {stat2Value || 'R$ 500K+'}
            </div>
            <div className="text-xs font-mono text-slate-400 uppercase">
              {stat2Label || 'Economia Gerada'}
            </div>
          </div>
          <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
            <div className={`text-3xl sm:text-4xl font-black ${theme.accentText} mb-1`}>
              {stat3Value || '100%'}
            </div>
            <div className="text-xs font-mono text-slate-400 uppercase">
              {stat3Label || 'Links Verificados'}
            </div>
          </div>
          <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
            <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1">
              {stat4Value || '24/7'}
            </div>
            <div className="text-xs font-mono text-slate-400 uppercase">
              {stat4Label || 'Varredura Contínua'}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
