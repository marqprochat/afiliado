import React from 'react';
import type { Metadata } from 'next';
import { GroupListSection } from '@/components/landing/group-list-section';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ArrowDown, CheckCircle, ShieldCheck, Flame, Bell, Sparkles } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Grupos de Ofertas do Dudu Rocha - Cupons e Descontos',
  description: 'Participe dos grupos oficiais do Dudu Rocha no WhatsApp e Telegram. Cupons e descontos em celulares, notebooks, tecnologia e muito mais!',
};

export default function LandpagePage() {
  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 font-sans selection:bg-[#25D366] selection:text-black">
      {/* Top Navbar */}
      <LandingNav />

      {/* Hero Header Estilo Canaltech Ofertas */}
      <header className="pt-28 pb-10 sm:pt-36 sm:pb-14 px-4 sm:px-6 max-w-4xl mx-auto text-center">
        {/* Logo / Badge Dudu Rocha */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366] text-xs sm:text-sm font-bold mb-6">
          <Flame className="w-4 h-4 text-[#25D366]" />
          <span>Grupos Oficiais do Dudu Rocha</span>
        </div>

        {/* Título Principal */}
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white mb-4 leading-tight">
          O Grupo que reúne as <span className="text-[#25D366]">melhores ofertas</span> para você em tempo real
        </h1>

        {/* Subtítulo */}
        <p className="text-slate-300 text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
          Receba cupons exclusivos, bugs de preço e promoções imperdíveis de tecnologia, smartphones e informática selecionados pela equipe do <strong>Dudu Rocha</strong>.
        </p>

        {/* Botão de Acesso Rápido */}
        <a
          href="#grupos"
          className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-[#25D366] hover:bg-[#22c35e] text-black font-extrabold text-sm sm:text-base shadow-lg shadow-[#25D366]/20 transition-all duration-150 uppercase tracking-wide"
        >
          <span>Escolher meu Grupo</span>
          <ArrowDown className="w-4 h-4" />
        </a>
      </header>

      {/* Cards de Benefícios / Dores (Inspirado no Canaltech) */}
      <section className="py-6 px-4 sm:px-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 rounded-xl bg-[#12151c] border border-slate-800 flex items-start gap-3.5">
            <span className="text-2xl">😭</span>
            <p className="text-sm text-slate-300 leading-relaxed">
              Você costuma <strong className="text-white">perder os melhores descontos</strong> porque sempre fica sabendo tarde demais quando os estoques já acabaram?
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#12151c] border border-slate-800 flex items-start gap-3.5">
            <span className="text-2xl">🤔</span>
            <p className="text-sm text-slate-300 leading-relaxed">
              Ou na hora de comprar fica com receio de <strong className="text-white">não ter encontrado o menor preço</strong> histórico do produto?
            </p>
          </div>
        </div>

        {/* Resolução */}
        <div className="mt-4 p-5 sm:p-6 rounded-xl bg-[#12151c] border border-slate-800 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#25D366] mb-1">
              Os Grupos do Dudu Rocha são a solução!
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              Nossa equipe monitora 24 horas as principais lojas do Brasil para entregar no seu WhatsApp apenas as ofertas que realmente valem a pena.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-300 shrink-0">
            <span className="flex items-center gap-1 text-[#25D366]">
              <CheckCircle className="w-4 h-4" /> 100% Grátis
            </span>
            <span className="flex items-center gap-1 text-[#25D366]">
              <ShieldCheck className="w-4 h-4" /> Zero Spam
            </span>
          </div>
        </div>
      </section>

      {/* Lista Principal de Botões Diretos de Grupos */}
      <GroupListSection />

      {/* Rodapé */}
      <LandingFooter />
    </div>
  );
}
