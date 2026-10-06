import React from 'react';
import type { Metadata } from 'next';
import { ThreeCanvas } from '@/components/landing/three-canvas';
import { LandingNav } from '@/components/landing/landing-nav';
import { GroupListSection } from '@/components/landing/group-list-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { FaqSection } from '@/components/landing/faq-section';
import { LandingFooter } from '@/components/landing/landing-footer';
import { Sparkles, ArrowDown, Shield, Users, Zap, CheckCircle2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Central de Grupos & Canais de Descontos | Afilados',
  description: 'Encontre e acesse nossas comunidades oficiais organizadas por categoria e rótulo. Redirecionamento automático e vagas sempre ativas.',
};

export default function GruposLandingPage() {
  return (
    <div className="min-h-screen bg-[#08090e] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      {/* Top Navbar */}
      <LandingNav />

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col items-center text-center">
        {/* Ambient Lighting & Background 3D Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/20 to-pink-500/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse" />
        <div className="absolute top-10 left-10 w-72 h-72 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none -z-10" />

        {/* Hero Top Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 border border-indigo-500/30 text-indigo-300 text-xs sm:text-sm font-semibold mb-8 backdrop-blur-xl shadow-lg shadow-indigo-500/10 animate-bounce">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span>Comunidade Oficial de Grupos & Canais</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl leading-[1.1] mb-6">
          Divulgação Inteligente de <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            Grupos por Rótulo & Categoria
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-slate-300 text-base sm:text-lg lg:text-xl max-w-2xl font-normal leading-relaxed mb-10">
          Acesse nossas comunidades oficiais de descontos e promoções com rotação automatizada, vagas sempre garantidas e zero spam.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-12">
          <a
            href="#grupos"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-extrabold text-base shadow-xl shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:scale-105 active:scale-95 transition-all duration-200"
          >
            <span>Explorar Grupos</span>
            <ArrowDown className="w-5 h-5 animate-bounce" />
          </a>
        </div>

        {/* Hero Live Stats Bar */}
        <div className="w-full max-w-3xl grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 sm:p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xl shadow-2xl mb-12">
          <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800/60 last:border-r-0 sm:last:border-r">
            <span className="text-2xl sm:text-3xl font-black text-indigo-400">100%</span>
            <span className="text-xs text-slate-400 font-medium">Vagas Garantidas</span>
          </div>
          <div className="flex flex-col items-center justify-center p-3 border-r border-slate-800/60 sm:border-r">
            <span className="text-2xl sm:text-3xl font-black text-purple-400">Automática</span>
            <span className="text-xs text-slate-400 font-medium">Rotação de Grupos</span>
          </div>
          <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center p-3">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400">24/7</span>
            <span className="text-xs text-slate-400 font-medium">Alertas & Cupons</span>
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
