import React from 'react';
import type { Metadata } from 'next';
import { GroupListSection } from '@/components/landing/group-list-section';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { WhatsappTestimonials } from '@/components/landing/whatsapp-testimonials';
import { FeaturesSection } from '@/components/landing/features-section';
import { FaqSection } from '@/components/landing/faq-section';
import {
  ArrowDown,
  CheckCircle2,
  ShieldCheck,
  Flame,
  Zap,
  TrendingDown,
  Smartphone,
  Laptop,
  Tag,
  Home,
  Headphones,
  Award,
  Users,
  Check,
} from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Grupos VIP de Ofertas e Cupons do Dudu Rocha',
  description: 'Receba cupons secretos, bugs de preço e as melhores ofertas de todas as categorias direto no seu WhatsApp com o Dudu Rocha!',
};

const CATEGORIES_MATRIX = [
  {
    code: 'M 01',
    title: 'Geral & Bugs de Preço',
    desc: 'O canal principal e mais urgente. Quedas repentinas de preço, erros de precificação das lojas e as maiores ofertas do dia reunidas em tempo real.',
    icon: Flame,
    color: 'text-red-500',
  },
  {
    code: 'M 02',
    title: 'Smartphones & Celulares',
    desc: 'Linhas Samsung Galaxy, iPhones, Xiaomi, Motorola e dobráveis. Alertas com o menor preço histórico, combos promocionais e cashback.',
    icon: Smartphone,
    color: 'text-cyan-400',
  },
  {
    code: 'M 03',
    title: 'Cupons & Descontos Secretos',
    desc: 'Cupons exclusivos de Mercado Livre, Amazon, Shopee, Magalu e KaBuM testados e validados minuto a minuto antes de esgotarem.',
    icon: Tag,
    color: 'text-amber-400',
  },
  {
    code: 'M 04',
    title: 'Notebooks & Informática',
    desc: 'Laptops para produtividade, MacBooks, monitores ultrawide, peças de hardware e periféricos gamer com descontos agressivos.',
    icon: Laptop,
    color: 'text-blue-400',
  },
  {
    code: 'M 05',
    title: 'Casa Inteligente & Eletro',
    desc: 'Air fryers, aspiradores robô, máquinas lava e seca, cafeteiras, Smart TVs 4K e dispositivos smart home no menor valor registrado.',
    icon: Home,
    color: 'text-emerald-400',
  },
  {
    code: 'M 06',
    title: 'Áudio & Wearables',
    desc: 'Fones bluetooth com cancelamento ativo de ruído (TWS), soundbars, caixas de som JBL e smartwatches com garantia e procedência.',
    icon: Headphones,
    color: 'text-purple-400',
  },
];

export default function LandpagePage() {
  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 font-sans selection:bg-red-600 selection:text-white relative overflow-x-hidden">
      {/* Top Navbar */}
      <LandingNav />

      {/* ======================================================== */}
      {/* DOBRA 1: HERO SECTION (ESTILO CURSO LP BEHANCE)          */}
      {/* ======================================================== */}
      <header className="relative pt-28 pb-16 sm:pt-36 sm:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Subtle Architectural Grid Lines */}
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
          <div className="absolute top-1/4 left-0 w-full h-[1px] bg-white/[0.04]" />
          <div className="absolute top-3/4 left-0 w-full h-[1px] bg-white/[0.04]" />
          <div className="absolute top-0 left-1/4 w-[1px] h-full bg-white/[0.04]" />
          <div className="absolute top-0 right-1/4 w-[1px] h-full bg-white/[0.04]" />
          
          {/* Ambient Lighting Spheres */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-red-600/10 rounded-full blur-[160px]" />
          <div className="absolute -top-10 right-0 w-[400px] h-[400px] bg-emerald-600/10 rounded-full blur-[140px]" />
        </div>

        {/* Blueprint Framing Container */}
        <div className="relative border border-white/10 rounded-3xl p-6 sm:p-10 lg:p-12 bg-gradient-to-b from-[#0b0e16]/90 via-[#0a0d14]/90 to-[#07090e]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Guide tags on borders */}
          <div className="absolute top-3 left-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest pointer-events-none">
            [ RADAR DE OFERTAS · DUDU ROCHA ]
          </div>
          <div className="absolute top-3 right-4 text-[10px] font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            24H LIVE MONITORING
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center pt-4">
            {/* Left Column: High-Impact Typography & Action */}
            <div className="lg:col-span-7 text-center lg:text-left">
              {/* Category Pill */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-5">
                <Flame className="w-3.5 h-3.5 text-red-500" />
                <span>COMUNIDADE VIP EXCLUSIVA NO WHATSAPP</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.08] uppercase mb-6">
                RECEBA OFERTAS <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-rose-500 to-red-400">SECRETAS</span>, BUGS DE PREÇO E CUPONS REAIS
              </h1>

              {/* Sub-headline */}
              <p className="text-slate-300 text-sm sm:text-base lg:text-lg leading-relaxed mb-8 max-w-2xl mx-auto lg:mx-0">
                Pare de pagar caro! Acompanhe em tempo real o radar 24h da equipe do <strong>Dudu Rocha</strong> garimpando descontos históricos de smartphones, informática, games, TVs e produtos para casa.
              </p>

              {/* Main Glowing Action Button */}
              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start mb-6">
                <a
                  href="#grupos"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-500 hover:from-red-500 hover:to-rose-400 text-white font-black text-sm sm:text-base uppercase tracking-wider shadow-[0_0_35px_rgba(239,68,68,0.45)] hover:scale-105 active:scale-95 transition-all duration-200"
                >
                  <span>QUERO ENTRAR NOS GRUPOS VIP</span>
                  <ArrowDown className="w-5 h-5 animate-bounce" />
                </a>
              </div>

              {/* Value Guarantees */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 sm:gap-6 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> 100% Gratuito
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Links Verificados
                </span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Sem Spam ou Bate-papo
                </span>
              </div>
            </div>

            {/* Right Column: Dudu Rocha Hero with Floating Live Savings Badges */}
            <div className="lg:col-span-5 flex justify-center relative">
              <div className="relative w-full max-w-md">
                {/* Neon Backlight Behind Image */}
                <div className="absolute -inset-4 bg-gradient-to-tr from-red-600/30 via-rose-500/20 to-emerald-500/20 rounded-3xl blur-2xl opacity-70" />

                {/* Framed Dudu Rocha Image */}
                <div className="relative rounded-2xl overflow-hidden border-2 border-white/10 bg-[#0e121a] shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/dudu-hero.jpg"
                    alt="Dudu Rocha com Cupons e Descontos"
                    className="w-full h-auto object-cover hover:scale-105 transition-transform duration-700"
                  />

                  {/* Dark Gradient Overlay at Bottom of Image */}
                  <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black via-black/60 to-transparent" />

                  {/* Creator Label */}
                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                    <div>
                      <div className="text-white font-black text-sm tracking-wide">DUDU ROCHA</div>
                      <div className="text-slate-400 text-[11px] font-mono">+12 ANOS NO YOUTUBE</div>
                    </div>
                    <div className="px-2.5 py-1 rounded bg-black/80 border border-white/20 text-emerald-400 text-[10px] font-mono font-bold">
                      VERIFICADO
                    </div>
                  </div>
                </div>

                {/* Floating Notification Card 1 (Top Left) */}
                <div className="absolute -top-4 -left-4 sm:-left-8 p-3 rounded-xl bg-[#0c1018]/95 border border-emerald-500/30 shadow-2xl backdrop-blur-md hidden sm:flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-mono uppercase">Menor Preço Detectado</div>
                    <div className="text-xs font-black text-emerald-400">+ R$ 2.450,00 OFF</div>
                  </div>
                </div>

                {/* Floating Notification Card 2 (Bottom Right) */}
                <div className="absolute -bottom-6 -right-4 sm:-right-8 p-3 rounded-xl bg-[#0c1018]/95 border border-red-500/30 shadow-2xl backdrop-blur-md hidden sm:flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                    <Flame className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-mono uppercase">Bug de Preço Mercado Livre</div>
                    <div className="text-xs font-black text-white">Cupom 60% OFF Aplicado</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Guide tag at the bottom of Dobra 1 */}
          <div className="mt-10 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            <span>[ FIM DA PRIMEIRA DOBRA ]</span>
            <span>ACESSO LIVRE & GRATUITO</span>
          </div>
        </div>
      </header>

      {/* ======================================================== */}
      {/* SEÇÃO: PARA QUEM É A COMUNIDADE? (SLICE 0 BEHANCE)       */}
      {/* ======================================================== */}
      <section id="para-quem" className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
            <span>[ CRITÉRIOS DE ADMISSÃO ]</span>
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight">
            PARA QUEM É A NOSSA COMUNIDADE?
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Card 1 */}
          <div className="p-7 rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl group">
            <div className="text-xs font-mono text-red-500 mb-4 font-black tracking-widest">[ 01 ]</div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-red-400 transition-colors">
              Quem quer comprar pagando o menor valor real
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Cansado da falsa "metade do dobro"? Nossa equipe monitora gráficos históricos para garantir que cada oferta postada represente uma economia verdadeira.
            </p>
          </div>

          {/* Card 2 */}
          <div className="p-7 rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl group">
            <div className="text-xs font-mono text-red-500 mb-4 font-black tracking-widest">[ 02 ]</div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-red-400 transition-colors">
              Caçadores de Cupons Secretos & Bugs
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Erros de precificação e cupons relâmpago de 30%, 50% e 70% costumam durar poucos minutos. Quem está no grupo é alertado imediatamente e garante primeiro.
            </p>
          </div>

          {/* Card 3 */}
          <div className="p-7 rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl group">
            <div className="text-xs font-mono text-red-500 mb-4 font-black tracking-widest">[ 03 ]</div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-red-400 transition-colors">
              Compradores que exigem segurança total
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              A internet está cheia de golpes e clones maliciosos. Todos os nossos links direcionam com exclusividade para as lojas e marcas oficiais verificadas do Brasil.
            </p>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* SEÇÃO: QUEM ESTÁ POR TRÁS DO RADAR? (AUTORIDADE SLICE 1) */}
      {/* ======================================================== */}
      <section id="quem-somos" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-4">
              <span>[ AUTORIDADE MÁXIMA EM TECNOLOGIA ]</span>
            </div>
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight mb-6">
              GARIMPANDO AS MELHORES OPORTUNIDADES DA INTERNET PRA VOCÊ.
            </h2>
            <div className="space-y-4 text-slate-300 text-sm sm:text-base leading-relaxed">
              <p>
                Nos últimos 12 anos, testei e avaliei os principais lançamentos de tecnologia do mundo no YouTube para uma comunidade de <strong>mais de 3,5 milhões de pessoas</strong>.
              </p>
              <p>
                Durante essa trajetória, percebi o quanto as pessoas perdem dinheiro comprando por impulso ou caindo em falsos descontos. Por isso, criei este radar com uma equipe especializada e algoritmos que monitoram os preços das grandes redes <strong>24 horas por dia</strong>.
              </p>
              <p className="text-white font-bold">
                Não estou aqui para te mandar promoções falsas. Estou aqui para garantir que cada real do seu suor seja investido no melhor produto pelo menor preço possível.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
              <div className="text-3xl sm:text-4xl font-black text-white mb-1">+3.5M</div>
              <div className="text-xs font-mono text-slate-400 uppercase">Inscritos no YouTube</div>
            </div>
            <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
              <div className="text-3xl sm:text-4xl font-black text-emerald-400 mb-1">+150K</div>
              <div className="text-xs font-mono text-slate-400 uppercase">Membros nos Grupos</div>
            </div>
            <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
              <div className="text-3xl sm:text-4xl font-black text-red-500 mb-1">R$ 4.8M+</div>
              <div className="text-xs font-mono text-slate-400 uppercase">Economia Gerada</div>
            </div>
            <div className="p-6 rounded-2xl bg-[#0b0e14] border border-white/10 text-center">
              <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1">24/7</div>
              <div className="text-xs font-mono text-slate-400 uppercase">Varredura Contínua</div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* SEÇÃO: CATEGORIAS & CONTEÚDO DOS GRUPOS (SLICE 2 & 3)    */}
      {/* ======================================================== */}
      <section id="categorias" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
            <span>[ MATRIZ DE CATEGORIAS ]</span>
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight mb-3">
            O QUE VOCÊ VAI RECEBER NOS GRUPOS
          </h2>
          <p className="text-slate-400 text-sm sm:text-base max-w-2xl">
            Canais setorizados com moderação profissional para você acompanhar apenas o que faz sentido para o seu bolso.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CATEGORIES_MATRIX.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <div
                key={idx}
                className="relative p-7 rounded-2xl bg-[#0b0e14] border border-white/10 hover:border-red-500/40 transition-all duration-300 shadow-xl group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-mono font-black text-red-500 tracking-wider">
                      {cat.code}
                    </span>
                    <Icon className={`w-5 h-5 ${cat.color}`} />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 group-hover:text-red-400 transition-colors">
                    {cat.title}
                  </h3>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    {cat.desc}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>WHATSAPP VIP</span>
                  <span className="text-emerald-400 font-bold">ATIVO</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ======================================================== */}
      {/* SEÇÃO: PROVA SOCIAL COM WHATSAPP CHATS (SLICE 2 BEHANCE) */}
      {/* ======================================================== */}
      <WhatsappTestimonials />

      {/* ======================================================== */}
      {/* SEÇÃO: LISTA INTERATIVA DE GRUPOS VIP (DIRETÓRIO ATIVO)  */}
      {/* ======================================================== */}
      <GroupListSection />

      {/* ======================================================== */}
      {/* SEÇÃO: DIFERENCIAIS EXCLUSIVOS (SLICE 4 BEHANCE)         */}
      {/* ======================================================== */}
      <FeaturesSection />

      {/* ======================================================== */}
      {/* SEÇÃO: FAQ (SLICE 6 BEHANCE)                             */}
      {/* ======================================================== */}
      <FaqSection />

      {/* ======================================================== */}
      {/* RODAPÉ ELEVADO (SLICE 6 BEHANCE)                         */}
      {/* ======================================================== */}
      <LandingFooter />
    </div>
  );
}
