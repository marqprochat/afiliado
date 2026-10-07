'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export function LandingNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0c10]/90 backdrop-blur-xl border-b border-emerald-500/20 py-3 shadow-2xl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between">
        {/* Dudu Rocha Brand Logo */}
        <Link href="/landpage" className="flex items-center gap-3 group">
          <div className="relative h-10 w-auto px-3 py-1 bg-black/90 rounded-xl flex items-center gap-2.5 border border-emerald-500/40 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://dudurochatec.com.br/wp-content/uploads/2025/02/imagem_2025-02-25_112238371.png"
              alt="Dudu Rocha Tec"
              className="h-5 sm:h-6 w-auto object-contain brightness-110"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div className="h-3.5 w-[1px] bg-slate-700" />
            <span className="px-2 py-0.5 rounded-md bg-[#27c40b]/15 text-[#27c40b] text-[11px] sm:text-xs font-black tracking-wider uppercase border border-[#27c40b]/30">
              OFERTAS
            </span>
          </div>
        </Link>

        {/* Selo Simples e Direto */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[#25D366] text-xs font-bold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Grupos Oficiais</span>
        </div>
      </div>
    </header>
  );
}
