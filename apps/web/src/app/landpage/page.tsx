import React from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { GroupListSection } from '@/components/landing/group-list-section';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ArrowDown, CheckCircle, ShieldCheck, Flame, Sparkles, Tag, Zap } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Grupos VIP de Ofertas e Cupons do Dudu Rocha',
  description: 'Receba cupons secretos, bugs de preço e as melhores ofertas de todas as categorias direto no seu WhatsApp com o Dudu Rocha!',
};

export default function LandpagePage() {
  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 font-sans selection:bg-[#25D366] selection:text-black">
      {/* Top Header Limpo */}
      <LandingNav />

      {/* Banner Principal de Alto Impacto */}
      <header className="pt-24 pb-8 sm:pt-32 sm:pb-12 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="bg-gradient-to-br from-[#121622] via-[#10141d] to-[#0d1017] border border-emerald-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
          {/* Luz de fundo decorativa */}
          <div className="absolute -top-24 -right-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 md:gap-10">
            {/* Imagem do Dudu Rocha com Cupons e Dinheiro */}
            <div className="w-full md:w-5/12 flex justify-center shrink-0">
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-tr from-[#25D366] via-emerald-400 to-cyan-400 rounded-3xl blur-md opacity-60 group-hover:opacity-100 transition duration-500" />
                <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 rounded-2xl overflow-hidden border-2 border-emerald-400/40 bg-black shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/dudu-hero.jpg"
                    alt="Dudu Rocha com Cupons e Descontos"
                    className="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-500"
                  />
                </div>
              </div>
            </div>

            {/* Copy Focado e Frase de Efeito */}
            <div className="w-full md:w-7/12 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#25D366]/15 border border-[#25D366]/40 text-[#25D366] text-xs sm:text-sm font-black mb-4 uppercase tracking-wider">
                <Flame className="w-4 h-4 text-[#25D366] animate-pulse" />
                <span>Economia Real no WhatsApp</span>
              </div>

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight mb-4">
                Pare de pagar caro! Receba <span className="text-[#25D366]">cupons secretos</span> e super ofertas todos os dias
              </h1>

              <p className="text-slate-300 text-sm sm:text-base lg:text-lg leading-relaxed mb-6">
                Acompanhe promoções imperdíveis de <strong>todas as categorias</strong>: smartphones, eletrônicos, informática, itens para casa, compras do dia a dia e erros de preço garimpados 24h pela equipe do <strong>Dudu Rocha</strong>.
              </p>

              {/* Benefícios Rápidos */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs sm:text-sm font-bold text-slate-200 mb-7">
                <span className="flex items-center gap-1.5 text-[#25D366]">
                  <CheckCircle className="w-4 h-4" /> 100% Gratuito
                </span>
                <span className="flex items-center gap-1.5 text-[#25D366]">
                  <ShieldCheck className="w-4 h-4" /> Links Verificados
                </span>
                <span className="flex items-center gap-1.5 text-[#25D366]">
                  <Zap className="w-4 h-4" /> Notificação na Hora
                </span>
              </div>

              {/* Botão de Ação Imediata */}
              <a
                href="#grupos"
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl bg-[#25D366] hover:bg-[#22c35e] text-black font-black text-sm sm:text-base shadow-xl shadow-[#25D366]/25 hover:scale-105 transition-all duration-150 uppercase tracking-wide w-full sm:w-auto"
              >
                <span>Quero Entrar nos Grupos VIP</span>
                <ArrowDown className="w-5 h-5 animate-bounce" />
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Lista Principal de Botões Diretos de Grupos com Fotos Grandes */}
      <GroupListSection />

      {/* Rodapé */}
      <LandingFooter />
    </div>
  );
}
