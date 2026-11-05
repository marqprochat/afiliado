'use client';

import React from 'react';
import Link from 'next/link';
import { Flame, ShieldCheck, ArrowRight } from 'lucide-react';

export function LandingNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#07090e]/90 backdrop-blur-xl border-b border-white/10 py-3 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Brand Logo & Authority Label */}
        <Link href="/landpage" className="flex items-center gap-3 group">
          <div className="relative h-10 px-3 py-1 bg-black/90 rounded-xl flex items-center gap-2.5 border border-white/10 group-hover:border-red-500/50 transition shadow-inner">
            <span className="text-sm font-black text-white tracking-tight">
              DUDU ROCHA <span className="text-red-500">TEC</span>
            </span>
            <div className="h-3.5 w-[1px] bg-white/20" />
            <span className="px-2 py-0.5 rounded-md bg-red-500/15 text-red-400 text-[10px] sm:text-[11px] font-black tracking-widest uppercase border border-red-500/30">
              VIP
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Radar 24h Ativo</span>
          </div>
        </Link>

        {/* Quick Nav Anchors */}
        <nav className="hidden md:flex items-center gap-6 text-xs uppercase tracking-wider font-bold text-slate-300">
          <a href="#para-quem" className="hover:text-red-400 transition">Para Quem É</a>
          <a href="#quem-somos" className="hover:text-red-400 transition">Autoridade</a>
          <a href="#depoimentos" className="hover:text-red-400 transition">Depoimentos</a>
          <a href="#categorias" className="hover:text-red-400 transition">Categorias</a>
          <a href="#faq" className="hover:text-red-400 transition">Dúvidas</a>
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <Link
            href="/ofertas"
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-slate-200 text-xs font-semibold transition cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>Ofertas no Site</span>
          </Link>

          <a
            href="#grupos"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-black uppercase tracking-wider transition-all duration-150 shadow-[0_0_20px_rgba(239,68,68,0.35)] hover:scale-105 active:scale-95"
          >
            <span>Entrar nos Grupos</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
