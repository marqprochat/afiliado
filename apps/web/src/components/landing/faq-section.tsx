'use client';

import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const FAQS = [
  {
    question: 'Como faço para entrar nos grupos do Dudu Rocha?',
    answer: 'É simples: escolha o grupo pelo rótulo de seu interesse (Geral Tech, Smartphones, Notebooks ou Cupons) e clique no botão verde "Entrar no Grupo Agora". Você será redirecionado imediatamente para a vaga ativa no WhatsApp ou Telegram.',
  },
  {
    question: 'Quanto custa para participar?',
    answer: 'Nada! Os grupos e canais de ofertas do Dudu Rocha são 100% gratuitos.',
  },
  {
    question: 'Os links e promoções são confiáveis?',
    answer: 'Sim! Todas as ofertas são verificadas pela equipe do canal Dudu Rocha e direcionam exclusivamente para lojas oficiais e confiáveis (Amazon, Mercado Livre, Shopee Oficial, Magalu, Samsung, etc.).',
  },
  {
    question: 'O grupo tem spam ou mensagens fora de hora?',
    answer: 'Não! Os grupos são configurados para receber apenas alertas essenciais de promoções selecionadas, mantendo o ambiente limpo e livre de conversas paralelas.',
  },
];

export function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto border-t border-slate-800/80">
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#27c40b]/10 border border-[#27c40b]/30 text-[#27c40b] text-xs sm:text-sm font-bold mb-4 backdrop-blur-md">
          <HelpCircle className="w-4 h-4 text-[#27c40b]" />
          <span>Dúvidas Frequentes</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3">
          Perguntas Frequentes
        </h2>
        <p className="text-slate-400 text-sm">Tudo o que você precisa saber sobre a nossa comunidade de ofertas</p>
      </div>

      <div className="space-y-4">
        {FAQS.map((faq, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div
              key={idx}
              className="rounded-2xl bg-[#0d1017]/80 border border-slate-800 backdrop-blur-xl overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="w-full flex items-center justify-between p-6 text-left font-bold text-white text-base sm:text-lg hover:text-[#27c40b] transition"
              >
                <span>{faq.question}</span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
                    isOpen ? 'rotate-180 text-[#27c40b]' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-6 pb-6 text-slate-300 text-sm leading-relaxed border-t border-slate-800/60 pt-4">
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
