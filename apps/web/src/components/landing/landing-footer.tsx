'use client';

import React from 'react';
import Link from 'next/link';
import { Sparkles, Shield, Heart } from 'lucide-react';

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 p-0.5">
            <div className="w-full h-full bg-slate-950 rounded-[6px] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
          <span className="text-sm font-bold text-slate-200">
            AFILADOS <span className="text-indigo-400">GROUPS</span>
          </span>
        </div>

        <p className="text-slate-500 text-xs text-center">
          &copy; {new Date().getFullYear()} Central de Grupos & Redirecionamento de Links Fixos. Todos os direitos reservados.
        </p>

        <div className="flex items-center gap-6 text-xs text-slate-400">
          <a href="#grupos" className="hover:text-white transition">Grupos</a>
          <a href="#diferenciais" className="hover:text-white transition">Diferenciais</a>
          <Link href="/links-grupos" className="hover:text-indigo-400 transition font-semibold">
            Painel do Gestor
          </Link>
        </div>
      </div>
    </footer>
  );
}
