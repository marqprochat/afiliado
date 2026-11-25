'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';

interface PublicCouponItem {
  id: string;
  store: string;
  advertiserName: string | null;
  code: string;
  description: string;
  terms: string | null;
  discountType: string | null;
  discountValue: number | null;
  minSpend: number | null;
  expiresAt: string | null;
  affiliateUrl: string | null;
  sourceUrl: string | null;
}

interface LookupResult {
  marketplace: string;
  storeLabel: string;
  originalUrl: string;
  resolvedUrl: string;
  affiliateUrl: string;
  coupons: PublicCouponItem[];
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PublicCuponsPage() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [recentCoupons, setRecentCoupons] = useState<PublicCouponItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/public/coupons')
      .then((res) => (res.ok ? res.json() : { coupons: [] }))
      .then((data) => setRecentCoupons(data.coupons ?? []))
      .catch(() => {});
  }, []);

  async function runLookup(targetUrl: string) {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/coupons/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || 'Não foi possível verificar este link.');
      }
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar cupons.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasteClick() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setUrlInput(text.trim());
        void runLookup(text.trim());
      }
    } catch {
      // Permissão de clipboard negada no navegador
    }
  }

  async function handleCopyCode(id: string, code: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  }

  const displayedCoupons = result ? result.coupons : recentCoupons;

  return (
    <div className="min-h-screen bg-[#080a0f] text-slate-100 font-sans flex flex-col justify-between">
      <LandingNav />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-24 sm:pt-28 pb-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[#25D366] text-xs font-black uppercase tracking-wider mb-4">
            <Ticket className="w-4 h-4" />
            <span>Buscador de Cupons por Link</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-3">
            Cole o link do produto e descubra se tem{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              cupom ativo
            </span>
          </h1>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            Funciona direto no celular para Shopee, Mercado Livre, Amazon, AliExpress, Magalu, Kabum e centenas de lojas parceiras.
          </p>
        </div>

        {/* Formulário Mobile-First */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup(urlInput);
          }}
          className="rounded-2xl bg-[#111622] border border-slate-800 p-3 sm:p-4 shadow-2xl mb-6"
        >
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Cole aqui o link da loja ou produto..."
                aria-label="Link do produto ou loja"
                className="w-full pl-10 pr-20 py-3 bg-[#090d16] border border-slate-800 focus:border-emerald-500 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePasteClick}
                className="absolute right-2 top-2 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Colar</span>
              </button>
            </div>
            <button
              type="submit"
              disabled={loading || !urlInput.trim()}
              className="py-3 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>Buscar Cupons</span>
            </button>
          </div>
          {error && (
            <p className="mt-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Card do Link Rastreado após consulta */}
        {result && (
          <div className="mb-8 rounded-2xl bg-gradient-to-br from-[#121927] to-[#0c111b] border border-emerald-500/35 p-4 sm:p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold">
                    {result.storeLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Link verificado
                  </span>
                </div>
                <p className="text-sm font-semibold text-white">
                  {result.coupons.length > 0
                    ? `Encontramos ${result.coupons.length} cupom(ns) válido(s) para ${result.storeLabel}!`
                    : `Nenhum cupom ativo cadastrado para ${result.storeLabel} no momento.`}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Use o botão ao lado para abrir o produto com segurança e garantir rastreamento de ofertas.
                </p>
              </div>
              <a
                href={result.affiliateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 py-3 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition"
              >
                <span>Ir para {result.storeLabel}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}

        {/* Lista de Cupons Válidos */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>
                {result ? `Cupons disponíveis (${displayedCoupons.length})` : 'Cupons ativos no momento'}
              </span>
            </h2>
            <Link href="/ofertas" className="text-xs text-emerald-400 hover:underline">
              Ver vitrine de ofertas →
            </Link>
          </div>

          {displayedCoupons.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0e131d] p-8 text-center text-sm text-slate-400">
              {result
                ? 'Sem cupons ativos para esta loja agora. Você ainda pode acessar a loja pelo link acima.'
                : 'Nenhum cupom ativo encontrado no momento. Cole um link acima para verificar uma loja.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {displayedCoupons.map((c) => {
                const exp = formatExpiry(c.expiresAt);
                const targetHref = c.affiliateUrl || result?.affiliateUrl || c.sourceUrl || '#';
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-slate-800 bg-[#101521] p-4 flex flex-col justify-between gap-3 hover:border-emerald-500/40 transition"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                          {c.advertiserName || c.store}
                        </span>
                        {exp && (
                          <span className="text-[11px] text-slate-400">Válido até {exp}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-white mb-1">{c.description}</p>
                      {c.terms && (
                        <p className="text-xs text-slate-400 line-clamp-2">{c.terms}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => void handleCopyCode(c.id, c.code)}
                        className="flex-1 py-2 px-3 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/10 text-emerald-300 font-mono font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-500/20 cursor-pointer"
                      >
                        {copiedId === c.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{c.code}</span>
                          </>
                        )}
                      </button>
                      {targetHref !== '#' && (
                        <a
                          href={targetHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1"
                        >
                          <span>Usar</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
