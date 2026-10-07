import React from 'react';
import type { Metadata } from 'next';
import { ThreeCanvas } from '@/components/landing/three-canvas';
import { LandingNav } from '@/components/landing/landing-nav';
import { GroupListSection } from '@/components/landing/group-list-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { FaqSection } from '@/components/landing/faq-section';
import { LandingFooter } from '@/components/landing/landing-footer';
import { Sparkles, ArrowDown, Youtube, CheckCircle2, Flame } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Grupos Oficiais de Ofertas do Dudu Rocha | Tecnologia & Cupons',
  description: 'Participe gratuitamente dos Grupos VIP de Ofertas do Dudu Rocha. Celulares, notebooks, periféricos, cupons e bugs de preço com desconto real.',
};

export default function LandpagePage() {
  return (
    <div className="min-h-screen bg-[#07080b] text-slate-100 font-sans selection:bg-[#27c40b] selection:text-black overflow-x-hidden">
      {/* Top Navbar with Dudu Rocha Branding */}
      <LandingNav />

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col items-center text-center">
        {/* Ambient Lighting & Background 3D Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#27c40b]/15 via-cyan-600/15 to-emerald-500/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse" />
        <div className="absolute top-10 left-10 w-72 h-72 bg-[#27c40b]/10 rounded-full blur-[100px] pointer-events-none -z-10" />

        {/* Hero Top Authority Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 border border-[#27c40b]/40 text-[#27c40b] text-xs sm:text-sm font-black mb-8 backdrop-blur-xl shadow-lg shadow-emerald-500/10">
          <Flame className="w-4 h-4 text-[#27c40b]" />
          <span>GRUPOS VIP DE OFERTAS · CANAL DUDU ROCHA</span>
        </div>

        {/* Hero Main Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl leading-[1.1] mb-6">
          Receba as Melhores Ofertas de <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-[#27c40b] via-[#00d084] to-cyan-400 bg-clip-text text-transparent">
            Tecnologia & Celulares no WhatsApp
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-slate-300 text-base sm:text-lg lg:text-xl max-w-3xl font-normal leading-relaxed mb-10">
          Curadoria diária feita pela equipe do <strong>Dudu Rocha</strong> (+3.5 Milhões no YouTube). 
          Alertas em tempo real de menores preços históricos, cupons secretos e bugs em lojas oficiais.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-12">
          <a
            href="#grupos"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-[#27c40b] via-[#22b809] to-[#00d084] hover:brightness-110 text-black font-black text-base shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105 active:scale-95 transition-all duration-200 uppercase tracking-wide"
          >
            <span>Ver Grupos Disponíveis</span>
            <ArrowDown className="w-5 h-5 animate-bounce" />
          </a>
        </div>

        {/* Hero Live Stats Bar */}
        <div className="w-full max-w-3xl grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 sm:p-6 rounded-2xl bg-[#0d1017]/80 border border-slate-800 backdrop-blur-xl shadow-2xl mb-12">
          <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800/80 last:border-r-0 sm:last:border-r">
            <span className="text-2xl sm:text-3xl font-black text-[#27c40b]">100% Grátis</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Acesso Instantâneo</span>
          </div>
          <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800/80 sm:border-r">
            <span className="text-2xl sm:text-3xl font-black text-cyan-400">+3.5 Milhões</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Seguidores do Canal</span>
          </div>
          <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center p-3">
            <span className="text-2xl sm:text-3xl font-black text-amber-400">Zero Spam</span>
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Apenas Ofertas Reais</span>
          </div>
        </div>

        {/* 3D Interactive Canvas Element */}
        <div className="w-full max-w-4xl">
          <ThreeCanvas />
        </div>
      </section>

      {/* Dynamic Group List & Identity Filter Section */}
      <GroupListSection />

      {/* Features & Highlights */}
      <FeaturesSection />

      {/* FAQ Section */}
      <FaqSection />

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
