'use client';

import React, { useState } from 'react';
import { ChevronDown, HelpCircle, ShieldCheck } from 'lucide-react';

const FAQS = [
  {
    question: 'Quanto custa para participar dos grupos VIP do Dudu Rocha?',
    answer: 'Nada! O acesso a todos os grupos VIP é 100% gratuito. Você não paga mensalidade, taxa de adesão ou qualquer outro valor para receber nossos alertas de desconto.',
  },
  {
    question: 'Como faço para entrar no grupo do WhatsApp?',
    answer: 'Basta escolher a categoria de seu maior interesse na lista acima (Geral, Celulares, Cupons, Notebooks ou Casa) e clicar no botão "Entrar no Grupo". Você será direcionado imediatamente para uma vaga disponível no WhatsApp.',
  },
  {
    question: 'As ofertas e links são realmente confiáveis?',
    answer: 'Sim, com total segurança! Toda oferta é auditada pela equipe oficial do canal Dudu Rocha. Só divulgamos produtos vendidos e entregues pelas maiores lojas do Brasil (Amazon, Mercado Livre Oficial, Magalu, Shopee Oficial, KaBuM, etc.). Jamais divulgamos links suspeitos.',
  },
  {
    question: 'O grupo tem mensagens excessivas ou spam?',
    answer: 'Não! Os grupos são administrados exclusivamente por nossa equipe e contam com envio focado apenas em ofertas reais, bugs de preço e cupons válidos. Não há bate-papo aberto, correntes ou mensagens fora de hora.',
  },
  {
    question: 'O que são os "Bugs de Preço" que vocês avisam?',
    answer: 'Bugs de preço são erros momentâneos de precificação ou aplicação acumulada de cupons nos sites das lojas que fazem o valor de um produto despencar drasticamente por poucos minutos. Quem está no grupo recebe o alerta na hora e consegue aproveitar antes da correção.',
  },
  {
    question: 'Posso participar de mais de um grupo?',
    answer: 'Sim! Você pode entrar no grupo Geral para ver tudo, e também nos grupos específicos (ex: Celulares ou Cupons) conforme sua necessidade de compra.',
  },
];

export function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto border-t border-white/10">
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider mb-3">
          <span>[ FAQ & RESPOSTAS ]</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight uppercase mb-3">
          PERGUNTAS FREQUENTES
        </h2>
        <p className="text-slate-400 text-sm sm:text-base">
          Tire suas dúvidas e entenda como funciona nossa curadoria diária de descontos
        </p>
      </div>

      <div className="space-y-3.5">
        {FAQS.map((faq, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div
              key={idx}
              className={`rounded-2xl transition-all duration-200 border ${
                isOpen
                  ? 'bg-[#0f131c] border-red-500/40 shadow-xl'
                  : 'bg-[#0a0d14] border-white/10 hover:border-white/20'
              }`}
            >
              <button
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="w-full flex items-center justify-between p-5 sm:p-6 text-left font-bold text-white text-sm sm:text-base hover:text-red-400 transition"
              >
                <span>{faq.question}</span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 shrink-0 ml-4 ${
                    isOpen ? 'rotate-180 text-red-500' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-5 sm:px-6 pb-6 text-slate-300 text-xs sm:text-sm leading-relaxed border-t border-white/5 pt-4">
                  {faq.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
