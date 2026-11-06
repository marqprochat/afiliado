'use client';

import React from 'react';
import { ShieldCheck, Heart } from 'lucide-react';

interface AffiliateFooterProps {
  authorName: string;
}

export function AffiliateFooter({ authorName }: AffiliateFooterProps) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 bg-[#05070a] py-12 px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 font-mono">
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-2 text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Comunidade Verificada · {authorName.toUpperCase()}</span>
        </div>

        <p className="max-w-xl text-[11px] leading-relaxed">
          Os preços, cupons e condições de pagamento anunciados estão sujeitos à alteração a qualquer momento
          pelos respectivos lojistas, sem aviso prévio. Os links enviados podem gerar comissão de afiliados.
        </p>

        <div className="pt-4 border-t border-white/5 w-full max-w-md flex items-center justify-center gap-1 text-[10px]">
          <span>© {currentYear} {authorName}. Todos os direitos reservados.</span>
        </div>
      </div>
    </footer>
  );
}
