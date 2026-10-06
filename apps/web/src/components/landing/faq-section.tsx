'use client';

import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const FAQS = [
  {
    question: 'Como faço para entrar nos grupos?',
    answer: 'Basta escolher o rótulo de seu interesse (ex: Promo VIP, Eletrônicos, Cupons) e clicar no botão "Entrar no Grupo". Nosso sistema identificará o grupo com vagas ativas e o redirecionará instantaneamente para o WhatsApp ou Telegram.',
  },
  {
    question: 'Os grupos são gratuitos?',
    answer: 'Sim, 100% gratuitos! Você não paga nada para entrar e permanecer nas nossas comunidades de ofertas.',
  },
  {
    question: 'O que acontece quando um grupo fica lotado?',
    answer: 'Você não precisa se preocupar. O sistema possui rotação automatizada em tempo real: assim que um grupo atinge a lotação limite, novos membros são automaticamente redirecionados para a nova turma sem interrupções.',
  },
  {
    question: 'Posso silenciar as notificações?',
    answer: 'Sim, todos os grupos podem ser silenciados a qualquer momento no seu próprio aplicativo. Enviamos apenas as melhores oportunidades do dia para evitar incômodos.',
  },
];

export function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="relative py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto border-t border-slate-800/60">
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs sm:text-sm font-medium mb-4 backdrop-blur-md">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>Tire suas Dúvidas</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-3">
          Perguntas Frequentes
        </h2>
        <p className="text-slate-400 text-sm">Tudo o que você precisa saber sobre nossos grupos de divulgação</p>
      </div>

      <div className="space-y-4">
        {FAQS.map((faq, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div
              key={idx}
              className="rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="w-full flex items-center justify-between p-6 text-left font-bold text-white text-base sm:text-lg hover:text-indigo-400 transition"
              >
                <span>{faq.question}</span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
                    isOpen ? 'rotate-180 text-indigo-400' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-6 pb-6 text-slate-300 text-xs sm:text-sm leading-relaxed border-t border-slate-800/50 pt-4">
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
