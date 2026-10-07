'use client';

import React from 'react';
import { Card3D } from './3d-card';
import { ShieldCheck, Zap, RefreshCw, BellRing, Sparkles, Smartphone, Award, Flame } from 'lucide-react';

const FEATURES = [
  {
    icon: Award,
    title: 'Curadoria Dudu Rocha (+12 Anos no YouTube)',
    description: 'Ofertas testadas e validadas por quem entende de tecnologia. Indicamos apenas produtos que realmente valem o investimento.',
    glow: 'rgba(39, 196, 11, 0.25)',
    badgeColor: 'text-[#27c40b] bg-[#27c40b]/10 border-[#27c40b]/30',
  },
  {
    icon: BellRing,
    title: 'Alertas de Menor Preço Histórico',
    description: 'Monitoramento em tempo real nos principais e-commerces (Mercado Livre, Amazon, Shopee, Magalu, KaBuM) com notificações imediatas.',
    glow: 'rgba(6, 182, 212, 0.25)',
    badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  },
  {
    icon: Flame,
    title: 'Bugs de Preço & Cupons Secretos',
    description: 'Acesso prioritário a cupons de desconto relâmpago e quedas de preço instantâneas antes que os estoques esgotem.',
    glow: 'rgba(245, 158, 11, 0.25)',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  {
    icon: RefreshCw,
    title: 'Vagas Sempre Garantidas',
    description: 'Sistema inteligente de links que rotaciona automaticamente para novos grupos quando um lote atinge o limite de membros.',
    glow: 'rgba(59, 130, 246, 0.25)',
    badgeColor: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  },
];

export function FeaturesSection() {
  return (
    <section id="diferenciais" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-slate-800/80">
      {/* Glow Backdrop */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#27c40b]/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#27c40b]/10 border border-[#27c40b]/30 text-[#27c40b] text-xs sm:text-sm font-bold mb-4 backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-[#27c40b]" />
          <span>Vantagens Exclusivas</span>
        </div>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight mb-4">
          Por que entrar nos grupos do <span className="bg-gradient-to-r from-[#27c40b] to-cyan-400 bg-clip-text text-transparent">Dudu Rocha?</span>
        </h2>
        <p className="text-slate-300 text-sm sm:text-base">
          Economize tempo e dinheiro recebendo apenas promoções reais e sem spam.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
        {FEATURES.map((feat, idx) => {
          const Icon = feat.icon;
          return (
            <Card3D key={idx} glowColor={feat.glow}>
              <div className="p-8 rounded-2xl bg-[#0d1017]/80 border border-slate-800 backdrop-blur-xl hover:border-emerald-500/40 transition duration-300 h-full flex flex-col justify-between shadow-xl">
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
