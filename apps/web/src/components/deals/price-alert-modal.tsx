'use client';

import React, { useState } from 'react';
import { Bell, CheckCircle2, MessageCircle, Mail, Sparkles, X, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

interface PriceAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  productSlug: string;
  productTitle: string;
  currentPrice: number;
}

export function PriceAlertModal({
  isOpen,
  onClose,
  productSlug,
  productTitle,
  currentPrice,
}: PriceAlertModalProps) {
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [recipient, setRecipient] = useState('');
  const [targetPrice, setTargetPrice] = useState(
    (currentPrice * 0.9).toFixed(2).replace('.', ','),
  );
  const [notifyOnAnyDrop, setNotifyOnAnyDrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const parsedPrice = notifyOnAnyDrop
        ? null
        : Number(targetPrice.replace(/\./g, '').replace(',', '.'));

      const res = await fetch(`/api/v1/deals/${productSlug}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient,
          channel,
          targetPrice: parsedPrice,
          notifyOnAnyDrop,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'Falha ao salvar alerta. Tente novamente.');
      }

      setSuccessMessage(data.status || 'Alerta ativado com sucesso!');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-xs">
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl text-slate-900 overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {successMessage ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 mx-auto mb-4 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center border border-emerald-200">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Alerta ativado</h3>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              {successMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold text-white transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer"
            >
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 pr-6">
              <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 border border-emerald-200">
                <Bell className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-lg text-slate-900">Quer pagar quanto?</h3>
                <p className="text-xs text-slate-500 line-clamp-1">{productTitle}</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
              <span className="text-slate-500">Preço atual:</span>
              <span className="text-emerald-700 font-bold text-sm tabular-nums">
                {formatCurrency(currentPrice)}
              </span>
            </div>

            {/* Seleção do canal */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Onde você quer ser avisado?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChannel('WHATSAPP')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    channel === 'WHATSAPP'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setChannel('EMAIL')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                    channel === 'EMAIL'
                      ? 'bg-sky-50 border-sky-500 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  E-mail
                </button>
              </div>
            </div>

            {/* Campo destinatário */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {channel === 'WHATSAPP' ? 'Seu WhatsApp (com DDD)' : 'Seu e-mail'}
              </label>
              <input
                type={channel === 'WHATSAPP' ? 'tel' : 'email'}
                required
                placeholder={channel === 'WHATSAPP' ? '(11) 99999-9999' : 'seu@email.com'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>

            {/* Preço Alvo ou Qualquer Queda */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Preço desejado
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnAnyDrop}
                    onChange={(e) => setNotifyOnAnyDrop(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-0"
                  />
                  <span>Qualquer queda</span>
                </label>
              </div>

              {!notifyOnAnyDrop && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[5, 10, 15, 20].map((pct) => {
                      const suggested = (currentPrice * (1 - pct / 100)).toFixed(2).replace('.', ',');
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setTargetPrice(suggested)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer tabular-nums"
                        >
                          -{pct}% (R$ {suggested})
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400 text-sm font-semibold">
                      R$
                    </span>
                    <input
                      type="text"
                      required={!notifyOnAnyDrop}
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 text-sm font-bold tabular-nums focus:outline-none focus:border-emerald-600 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold text-white text-sm flex items-center justify-center gap-2 transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Ativar alerta imediato
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
