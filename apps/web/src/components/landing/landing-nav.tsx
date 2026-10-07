'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Youtube, Instagram, ExternalLink, Menu, X, ShieldCheck } from 'lucide-react';

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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled
          ? 'bg-[#0a0c10]/90 backdrop-blur-xl border-b border-emerald-500/20 py-3 shadow-2xl shadow-emerald-950/20'
          : 'bg-transparent py-5'
        }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Dudu Rocha Brand Logo */}
        <Link href="/landpage" className="flex items-center gap-3.5 group">
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-[#27c40b] to-[#06b6d4] rounded-xl blur opacity-75 group-hover:opacity-100 transition duration-300" />
            <div className="relative h-11 w-auto px-3 py-1 bg-black rounded-lg flex items-center justify-center border border-emerald-500/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://dudurochatec.com.br/wp-content/uploads/2025/02/imagem_2025-02-25_112238371.png"
                alt="Dudu Rocha Tec"
                className="h-7 w-auto object-contain brightness-110"
                onError={(e) => {
                  // Fallback to text if remote image is blocked
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-black text-sm tracking-wider text-white flex items-center gap-1">
                <span className="text-[#27c40b]">OFERTAS</span>
              </span>
            </div>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
          <a href="#grupos" className="hover:text-[#27c40b] transition-colors flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#27c40b] animate-ping" />
            Grupos VIP
          </a>
          <a href="#diferenciais" className="hover:text-[#27c40b] transition-colors">
            Por que Participar?
          </a>
          <a href="#faq" className="hover:text-[#27c40b] transition-colors">
            Dúvidas Frequentes
          </a>
          <a
            href="https://dudurochatec.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-400 transition-colors flex items-center gap-1 text-slate-400"
          >
            <span>Site Oficial</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </nav>

        {/* Social Badges & Status */}
        <div className="hidden sm:flex items-center gap-3">
          <a
            href="https://www.youtube.com/channel/UCIhmXuqtOQVJCPbh_tXns1g"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-600/20 transition"
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>+3.5M Inscritos</span>
          </a>

          <a
            href="https://www.instagram.com/dudurocha.oficial"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink-600/10 border border-pink-500/20 text-pink-400 text-xs font-bold hover:bg-pink-600/20 transition"
          >
            <Instagram className="w-3.5 h-3.5" />
            <span>@dudurocha.oficial</span>
          </a>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0a0c10]/95 backdrop-blur-2xl border-b border-emerald-500/20 px-4 pt-4 pb-6 space-y-4 shadow-2xl">
          <a
            href="#grupos"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-100 font-bold py-2 hover:text-[#27c40b]"
          >
            🔥 Lista de Grupos VIP
          </a>
          <a
            href="#diferenciais"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-200 font-medium py-2 hover:text-[#27c40b]"
          >
            ✨ Por que Participar?
          </a>
          <a
            href="#faq"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-slate-200 font-medium py-2 hover:text-[#27c40b]"
          >
            ❓ Dúvidas Frequentes
          </a>
          <a
            href="https://dudurochatec.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-emerald-400 font-medium py-2"
          >
            🌐 Acessar Portal dudurochatec.com.br
          </a>
        </div>
      )}
    </header>
  );
}
