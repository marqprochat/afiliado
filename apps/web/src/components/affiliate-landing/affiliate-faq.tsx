'use client';

import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { getThemeStyles } from './theme';

interface AffiliateFaqProps {
  authorName: string;
  themeColor: string;
}

export function AffiliateFaq({ authorName, themeColor }: AffiliateFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const theme = getThemeStyles(themeColor);

  const faqs = [
    {
      q: 'Os grupos no WhatsApp são realmente 100% gratuitos?',
      a: `Sim! O acesso a todos os canais oficiais de ${authorName} é totalmente gratuito. Você não paga mensalidade, taxa de adesão ou qualquer custo para receber os alertas e bugs de preço.`,
    },
    {
      q: 'Qualquer pessoa pode mandar mensagens no grupo?',
      a: 'Não. Para garantir a melhor experiência e não sobrecarregar seu celular com conversas paralelas, apenas os moderadores e bots oficiais enviam mensagens com links verificados.',
    },
    {
      q: 'Como vocês encontram cupons e bugs de preço antes de todo mundo?',
      a: 'Utilizamos robôs de varredura contínua que consultam constantemente a API e catálogos das maiores lojas online (Mercado Livre, Amazon, Shopee, Magalu, KaBuM e outras), comparando os preços atuais com a média histórica.',
    },
    {
      q: 'Os links enviados são seguros?',
      a: 'Sim, 100% seguros. Todos os links direcionam exclusivamente para as lojas e varejistas oficiais autorizados pelo comércio eletrônico brasileiro. Nós nunca compartilhamos links suspeitos.',
    },
    {
      q: 'O que devo fazer assim que entrar no grupo?',
      a: 'Recomendamos fixar o grupo no topo do seu WhatsApp e ativar as notificações para não perder as ofertas relâmpago, que normalmente acabam em poucos minutos.',
    },
  ];

  return (
    <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto border-t border-white/10">
      <div className="text-center mb-12">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-3`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>TIRA-DÚVIDAS</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight uppercase">
          PERGUNTAS FREQUENTES
        </h2>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className="rounded-2xl bg-[#0b0e14] border border-white/10 overflow-hidden transition-colors"
            >
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full p-6 text-left flex items-center justify-between gap-4"
              >
                <span className="font-bold text-white text-base sm:text-lg">{faq.q}</span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-300 ${
                    isOpen ? 'rotate-180 text-white' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-6 pb-6 text-sm sm:text-base text-slate-300 leading-relaxed border-t border-white/5 pt-4">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
