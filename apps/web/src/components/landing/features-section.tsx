'use client';

import React from 'react';
import { Award, BellRing, Flame, RefreshCw, ShieldCheck, Zap } from 'lucide-react';

const DIFFERENTIALS = [
  {
    number: '01',
    icon: Award,
    title: 'Curadoria Dudu Rocha (+12 Anos no YouTube)',
    description: 'Ofertas testadas e validadas por quem é autoridade máxima em tecnologia. Indicamos apenas produtos que realmente valem o investimento.',
    accent: 'border-red-500/30 text-red-400 bg-red-500/10',
  },
  {
    number: '02',
    icon: BellRing,
    title: 'Radar de Menor Preço Histórico',
    description: 'Monitoramento contínuo em tempo real nas principais lojas do Brasil (Mercado Livre, Amazon, Shopee, Magalu e KaBuM) avisando quedas históricas de preço.',
    accent: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10',
  },
  {
    number: '03',
    icon: Flame,
    title: 'Bugs de Preço & Cupons Relâmpago',
    description: 'Acesso prioritário a cupons de desconto secretos e erros instantâneos de precificação antes que os estoques zerem ou as lojas corrijam.',
    accent: 'border-amber-500/30 text-amber-400 bg-amber-500/10',
  },
  {
    number: '04',
    icon: RefreshCw,
    title: 'Vagas Sempre Ativas e Sem Lotação',
    description: 'Sistema inteligente de links rotativos que redireciona automaticamente para um grupo novo e ativo assim que um lote atinge o limite do WhatsApp.',
    accent: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
  },
];

export function FeaturesSection() {
  return (
    <section id="diferenciais" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
      {/* Background Lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-600/5 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
          <span>[ DIFERENCIAIS EXCLUSIVOS ]</span>
        </div>
        <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase mb-4">
          POR QUE NOSSOS GRUPOS SÃO DIFERENTES?
        </h2>
        <p className="text-slate-400 text-sm sm:text-base">
          Economize tempo e dinheiro recebendo apenas promoções reais, sem mensagens paralelas e sem links suspeitos.
        </p>
      </div>

      {/* Grid with technical guides and node markers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
        {DIFFERENTIALS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="relative p-7 sm:p-8 rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl group flex flex-col justify-between"
            >
              {/* Corner node indicator */}
              <div className="absolute top-4 right-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                [ ITEM {item.number} ]
              </div>

              <div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${item.accent} mb-6 shadow-inner`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-red-400 transition-colors">
                  {item.title}
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-slate-500 font-mono">
                <span>PADRÃO DUDU ROCHA</span>
                <span className="text-emerald-400 font-bold">100% VERIFICADO</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
