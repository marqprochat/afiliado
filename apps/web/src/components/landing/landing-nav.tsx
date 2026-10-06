'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Shield, ArrowRight, Menu, X, LayoutDashboard } from 'lucide-react';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80 py-3 shadow-2xl'
          : 'bg-transparent py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Brand Logo & System Title */}
        <Link href="/grupos" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 p-0.5 shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-indigo-400 group-hover:rotate-12 transition-transform" />
            </div>
          </div>
          <div>
            <span className="text-lg font-black tracking-tight text-white group-hover:text-indigo-300 transition-colors">
              AFILADOS<span className="text-indigo-500">.</span>HUB
            </span>
            <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Comunidade Oficial
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <a href="#grupos" className="hover:text-indigo-400 transition-colors">
            Lista de Grupos
          </a>
          <a href="#diferenciais" className="hover:text-indigo-400 transition-colors">
            Diferenciais
          </a>
          <a href="#faq" className="hover:text-indigo-400 transition-colors">
            Perguntas Frequentes
          </a>
        </nav>

        {/* Status Indicator & Admin Button */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Sistema Online</span>
          </div>

          <Link
            href="/links-grupos"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-indigo-500/50 text-slate-200 hover:text-white text-xs font-bold transition shadow-sm"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-indigo-400" />
            <span>Gerenciar Grupos</span>
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950/95 backdrop-blur-2xl border-b border-slate-800 px-4 pt-4 pb-6 space-y-4">
          <a
            href="#grupos"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-200 font-medium py-2 hover:text-indigo-400"
          >
            Lista de Grupos
          </a>
          <a
            href="#diferenciais"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-200 font-medium py-2 hover:text-indigo-400"
          >
            Diferenciais
          </a>
          <a
            href="#faq"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-200 font-medium py-2 hover:text-indigo-400"
          >
            Perguntas Frequentes
          </a>
          <div className="pt-2 flex flex-col gap-3">
            <Link
              href="/links-grupos"
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white font-bold text-xs"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Acessar Painel do Gestor</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
