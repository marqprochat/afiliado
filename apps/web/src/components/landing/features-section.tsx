'use client';

import React from 'react';
import { Card3D } from './3d-card';
import { ShieldCheck, Zap, RefreshCw, BellRing, Sparkles, Lock } from 'lucide-react';

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Rotação Automática de Grupos',
    description: 'Quando um grupo atinge o limite de membros, nosso sistema cria e redireciona automaticamente para o próximo grupo ativo sem perder nenhum lead.',
    glow: 'rgba(99, 102, 241, 0.2)',
    badgeColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  },
  {
    icon: ShieldCheck,
    title: 'Zero Spam & Anti-Golpes',
    description: 'Nossos canais e grupos contam com moderação contínua e bots dedicados para garantir apenas ofertas legítimas e cupons testados.',
    glow: 'rgba(16, 185, 129, 0.2)',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    icon: BellRing,
    title: 'Alertas de Bugs & Menor Preço',
    description: 'Curadoria em tempo real monitorando grandes e-commerces (Shopee, Mercado Livre, Amazon, Magalu) para notificar descontos em segundos.',
    glow: 'rgba(245, 158, 11, 0.2)',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    icon: Zap,
    title: 'Redirecionamento Instantâneo',
    description: 'Infraestrutura de alta velocidade que direciona o visitante em milissegundos para o aplicativo do WhatsApp ou Telegram instalado no dispositivo.',
    glow: 'rgba(6, 182, 212, 0.2)',
    badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  },
];

export function FeaturesSection() {
  return (
    <section id="diferenciais" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-slate-800/60">
      {/* Glow Backdrop */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs sm:text-sm font-medium mb-4 backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>Tecnologia de Ponta</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
          Por que entrar em nossas <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">comunidades?</span>
        </h2>
        <p className="text-slate-400 text-sm sm:text-base">
          Garantimos a melhor experiência para membros e a mais alta taxa de conversão do mercado.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
        {FEATURES.map((feat, idx) => {
          const Icon = feat.icon;
          return (
            <Card3D key={idx} glowColor={feat.glow}>
              <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl hover:border-slate-700 transition duration-300 h-full flex flex-col justify-between">
                <div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${feat.badgeColor} mb-6 shadow-inner`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{feat.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{feat.description}</p>
                </div>
              </div>
            </Card3D>
          );
        })}
      </div>
    </section>
  );
}
