'use client';

import { useState } from 'react';
import { Check, Copy, Ticket } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';

export interface DealCoupon {
  code: string;
  description: string;
  discountLabel: string | null;
  expiresAt: string | null;
}

export function DealCouponBlock({ coupons }: { coupons: DealCoupon[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (coupons.length === 0) return null;

  async function copy(code: string) {
    if (await copyToClipboard(code)) setCopied(code);
  }

  return (
    <section className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200 mb-6">
      <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
        <Ticket className="w-4 h-4 text-amber-600" />
        Cupom disponível
      </h2>
      <ul className="space-y-3">
        {coupons.map((c) => (
          <li
            key={c.code}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-amber-300 bg-white p-3.5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-base font-black tracking-wider text-slate-900">{c.code}</code>
                {c.discountLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                    {c.discountLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1">{c.description}</p>
              {c.expiresAt && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Válido até {new Date(c.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void copy(c.code)}
              aria-label={`Copiar cupom ${c.code}`}
              className="shrink-0 py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-[background-color,transform] duration-150 active:scale-[0.97] cursor-pointer"
            >
              {copied === c.code ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === c.code ? 'Copiado!' : 'Copiar'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
