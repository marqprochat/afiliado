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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#111622] border border-emerald-500/30 rounded-3xl p-6 shadow-2xl text-slate-100 overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white transition"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {successMessage ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto mb-4 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center border border-emerald-500/40">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Alerta Ativado!</h3>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              {successMessage}
            </p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 font-bold text-black shadow-lg shadow-emerald-500/20 transition cursor-pointer"
            >
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/20 rounded-xl text-emerald-400 border border-emerald-500/30">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Criar Alerta de Preço</h3>
                <p className="text-xs text-slate-400 line-clamp-1">{productTitle}</p>
              </div>
            </div>

            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400">Preço atual:</span>
              <span className="text-emerald-400 font-bold text-sm">
                {formatCurrency(currentPrice)}
              </span>
            </div>

            {/* Seleção do canal */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Onde você quer ser avisado?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChannel('WHATSAPP')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    channel === 'WHATSAPP'
                      ? 'bg-[#25D366]/20 border-[#25D366] text-[#25D366]'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setChannel('EMAIL')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    channel === 'EMAIL'
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  E-mail
                </button>
              </div>
            </div>

            {/* Campo destinatário */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                {channel === 'WHATSAPP' ? 'Seu WhatsApp (com DDD)' : 'Seu E-mail'}
              </label>
              <input
                type={channel === 'WHATSAPP' ? 'tel' : 'email'}
                required
                placeholder={channel === 'WHATSAPP' ? '(11) 99999-9999' : 'seu@email.com'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900/80 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500 transition"
              />
            </div>

            {/* Preço Alvo ou Qualquer Queda */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">
                  Preço desejado
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnAnyDrop}
                    onChange={(e) => setNotifyOnAnyDrop(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Qualquer queda</span>
                </label>
              </div>

              {!notifyOnAnyDrop && (
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 text-sm font-semibold">
                    R$
                  </span>
                  <input
                    type="text"
                    required={!notifyOnAnyDrop}
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900/80 border border-slate-800 rounded-xl text-white text-sm font-bold focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              )}
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 font-bold text-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Ativar Alerta Imediato
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
