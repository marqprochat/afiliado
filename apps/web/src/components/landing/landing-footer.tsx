'use client';

import React from 'react';
import { Sparkles, Youtube, Instagram, ExternalLink } from 'lucide-react';

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-800/80 bg-[#050608] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-auto px-2 py-0.5 bg-black rounded border border-emerald-500/40 flex items-center justify-center">
            <span className="text-xs font-black text-white">
              DUDU ROCHA <span className="text-[#27c40b]">TEC</span>
            </span>
          </div>
          <span className="text-sm font-bold text-slate-300">
            Comunidade Oficial de Ofertas & Achados
          </span>
        </div>

        <p className="text-slate-500 text-xs text-center">
          &copy; {new Date().getFullYear()} Dudu Rocha Tec. Todos os direitos reservados.
        </p>

        <div className="flex items-center gap-5 text-xs text-slate-400">
          <a
            href="https://www.youtube.com/channel/UCIhmXuqtOQVJCPbh_tXns1g"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-red-400 transition flex items-center gap-1 font-semibold"
          >
            <Youtube className="w-4 h-4" />
            <span>YouTube (+3.5M)</span>
          </a>
          <a
            href="https://www.instagram.com/dudurocha.oficial"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-pink-400 transition flex items-center gap-1 font-semibold"
          >
            <Instagram className="w-4 h-4" />
            <span>Instagram</span>
          </a>
          <a
            href="https://dudurochatec.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#27c40b] transition flex items-center gap-1 font-semibold"
          >
            <span>dudurochatec.com.br</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
