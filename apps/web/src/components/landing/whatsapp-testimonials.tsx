'use client';

import React from 'react';
import { Video, Phone, CheckCheck, Sparkles } from 'lucide-react';

interface Testimonial {
  name: string;
  avatarText: string;
  avatarBg: string;
  text: string;
  time: string;
  highlight: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Guilherme Borba',
    avatarText: 'GB',
    avatarBg: 'bg-emerald-700',
    text: 'O grupo é SENSACIONAL! Peguei o Galaxy S24 Ultra com o cupom de R$ 1.500 que vocês postaram de madrugada. Já se pagou pra vida inteira, economizei mais de R$ 2.200 somando com o cashback do banco!',
    time: '09:12',
    highlight: 'Economizou R$ 2.200 em Smartphone',
  },
  {
    name: 'Gabriela Bueno',
    avatarText: 'GB',
    avatarBg: 'bg-indigo-700',
    text: 'Entrei no grupo achando que era só mais um canal de spam, mas vocês só mandam pedrada! Acabei de equipar meu apartamento: comprei a lava e seca e a TV OLED pelo menor preço do histórico!',
    time: '14:35',
    highlight: 'Lava & Seca + TV OLED com desconto',
  },
  {
    name: 'Raphael Mendonça',
    avatarText: 'RM',
    avatarBg: 'bg-rose-700',
    text: 'Fala Dudu, vim te agradecer cara! O alerta do bug da Amazon ontem foi surreal kkkk comprei o monitor gamer da LG com 55% de desconto antes de corrigirem o preço. Valeu demais a agilidade!',
    time: '18:22',
    highlight: 'Pegou Bug de Preço da Amazon',
  },
  {
    name: 'Hiro Fukumoto',
    avatarText: 'HF',
    avatarBg: 'bg-amber-700',
    text: 'Já economizei mais de R$ 3.800 em 4 meses só acompanhando as notificações de informática. Os cupons secretos de Mercado Livre e Amazon que vocês postam ninguém mais encontra na internet.',
    time: '21:05',
    highlight: 'R$ 3.800+ economizados em informática',
  },
];

export function WhatsappTestimonials() {
  return (
    <section id="depoimentos" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="mb-14">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
          <span>[ PROVA SOCIAL REAL ]</span>
        </div>
        <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight mb-3">
          O QUE OS MEMBROS DIZEM:
        </h2>
        <p className="text-slate-400 text-sm sm:text-base max-w-2xl">
          Depoimentos reais enviados diariamente pelos participantes dos nossos grupos VIP no WhatsApp.
        </p>
      </div>

      {/* WhatsApp Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {TESTIMONIALS.map((item, idx) => (
          <div
            key={idx}
            className="flex flex-col rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl overflow-hidden group"
          >
            {/* Top WhatsApp Bar */}
            <div className="px-4 py-3 bg-[#161c26] border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-full ${item.avatarBg} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                  {item.avatarText}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-100 truncate">{item.name}</h4>
                  <span className="text-[10px] text-emerald-400 block font-mono">online no VIP</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-400 shrink-0">
                <Video className="w-3.5 h-3.5" />
                <Phone className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Chat Body */}
            <div className="p-4 flex-1 flex flex-col justify-between bg-[#0e121a]/95">
              <div className="rounded-xl p-3.5 bg-[#1a2332] text-slate-200 text-xs sm:text-sm leading-relaxed border border-white/5 shadow-inner">
                <p>{item.text}</p>
                <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-slate-400 font-mono">
                  <span>{item.time}</span>
                  <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
                </div>
              </div>

              {/* Tag / Highlight */}
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate">{item.highlight}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
