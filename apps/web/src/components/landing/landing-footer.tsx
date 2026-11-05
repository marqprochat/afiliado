'use client';

import React from 'react';
import { Youtube, Instagram, ExternalLink, ShieldCheck, Heart } from 'lucide-react';

export function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#050609] py-14 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
        {/* Brand & Authority */}
        <div className="flex flex-col items-center md:items-start gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-9 px-3 bg-black rounded-xl border border-white/10 flex items-center justify-center shadow-inner">
              <span className="text-xs font-black text-white tracking-tight">
                DUDU ROCHA <span className="text-red-500">TEC</span>
              </span>
            </div>
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">
              COMUNIDADE VIP
            </span>
          </div>
          <p className="text-slate-500 text-xs text-center md:text-left max-w-sm">
            Curadoria especializada e radar diário dos maiores descontos, cupons e bugs de tecnologia da internet.
          </p>
        </div>

        {/* Channels */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
          <a
            href="https://www.youtube.com/channel/UCIhmXuqtOQVJCPbh_tXns1g"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-red-400 transition flex items-center gap-1.5 font-bold"
          >
            <Youtube className="w-4 h-4 text-red-500" />
            <span>YouTube (+3.5M)</span>
          </a>
          <a
            href="https://www.instagram.com/dudurocha.oficial"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-pink-400 transition flex items-center gap-1.5 font-bold"
          >
            <Instagram className="w-4 h-4 text-pink-500" />
            <span>Instagram</span>
          </a>
          <a
            href="https://dudurochatec.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition flex items-center gap-1.5 font-bold"
          >
            <span>dudurochatec.com.br</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Copyright */}
        <div className="flex flex-col items-center md:items-end text-xs text-slate-500 gap-1 font-mono">
          <span>&copy; {new Date().getFullYear()} DUDU ROCHA TEC.</span>
          <span>TODOS OS DIREITOS RESERVADOS.</span>
        </div>
      </div>
    </footer>
  );
}
