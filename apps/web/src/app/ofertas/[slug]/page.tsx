'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ExternalLink,
  Bell,
  Store,
  Flame,
  Sparkles,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { PriceHistoryChart } from '@/components/deals/price-history-chart';
import { PriceAlertModal } from '@/components/deals/price-alert-modal';
import { formatCurrency } from '@/lib/format';

interface ListingItem {
  id: string;
  storeName: string;
  source: string;
  currentPrice: number;
  originalPrice?: number | null;
  discountPct?: number | null;
  affiliateUrl?: string | null;
  imageUrl?: string | null;
  lastCheckedAt?: string | Date;
}

interface DealDetail {
  id: string;
  title: string;
  cleanTitle: string;
  slug: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  images: string[];
  currentBestPrice: number;
  lowestPriceEver: number;
  averagePrice30d: number;
  listingsCount: number;
  analysis: {
    badge: 'ALL_TIME_LOW' | 'GREAT_DEAL' | 'FAIR_PRICE' | 'INFLATED_DISCOUNT';
    badgeLabel: string;
    averagePrice: number;
    lowestPriceEver: number;
    realDiscountPct: number;
    isRealPromotion: boolean;
  };
  listings: ListingItem[];
  priceHistory: {
    storeName: string;
    source: string;
    price: number;
    recordedAt: string;
  }[];
}

export default function OfertaDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);

    fetch(`/api/v1/deals/${slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setDeal(data);
        if (data?.imageUrl) setSelectedImage(data.imageUrl);
        setLoading(false);
      })
      .catch(() => {
        setDeal(null);
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080a0f] text-slate-100 flex flex-col justify-between">
        <LandingNav />
        <div className="flex flex-col items-center justify-center py-40">
          <RefreshCw className="w-9 h-9 text-emerald-400 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Carregando comparador e histórico de preços...</p>
        </div>
        <LandingFooter />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-[#080a0f] text-slate-100 flex flex-col justify-between">
        <LandingNav />
        <div className="text-center py-40 max-w-md mx-auto px-4">
          <h2 className="text-2xl font-bold text-white mb-2">Produto não encontrado</h2>
          <p className="text-slate-400 text-sm mb-6">
            O link pode estar expirado ou o produto foi removido.
          </p>
          <Link
            href="/ofertas"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl text-sm transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para a Vitrine de Ofertas
          </Link>
        </div>
        <LandingFooter />
      </div>
    );
  }

  const bestListing = deal.listings[0] ?? null;
  const isAllTimeLow = deal.analysis.badge === 'ALL_TIME_LOW';

  return (
    <div className="min-h-screen bg-[#080a0f] text-slate-100 font-sans flex flex-col justify-between">
      <LandingNav />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-28 pb-16">
        {/* Navegação Topo */}
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-6">
          <Link href="/ofertas" className="hover:text-emerald-400 transition flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Todas as Ofertas
          </Link>
          <span>/</span>
          <span className="text-slate-500">{deal.category ?? 'Produtos'}</span>
          <span>/</span>
          <span className="text-slate-300 truncate max-w-xs">{deal.cleanTitle}</span>
        </div>

        {/* Bloco Principal do Produto */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-10">
          {/* Coluna Visual (Foto & Miniaturas) */}
          <div className="md:col-span-5 flex flex-col items-center">
            <div className="relative aspect-square w-full max-w-sm rounded-3xl bg-black/60 border border-slate-800 p-6 flex items-center justify-center shadow-2xl mb-4 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedImage || deal.imageUrl || ''}
                alt={deal.cleanTitle}
                className="w-full h-full object-contain"
              />

              {isAllTimeLow && (
                <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/30">
                  <Flame className="w-3.5 h-3.5 fill-black" />
                  Mínima Histórica
                </div>
              )}
            </div>

            {deal.images && deal.images.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto max-w-sm py-1">
                {deal.images.slice(0, 5).map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(img)}
                    className={`relative w-14 h-14 rounded-xl bg-black/40 border p-1 transition cursor-pointer shrink-0 ${
                      selectedImage === img ? 'border-emerald-500 shadow-md' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Coluna de Preço e Ações Principais */}
          <div className="md:col-span-7 flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {deal.brand && (
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold">
                    {deal.brand}
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                  {deal.analysis.badgeLabel}
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-black text-white mb-4 leading-snug">
                {deal.cleanTitle}
              </h1>

              {/* Box de Menor Preço (Buy Box) */}
              <div className="p-6 rounded-3xl bg-gradient-to-br from-[#121824] to-[#0d121c] border border-emerald-500/40 shadow-xl mb-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10 text-emerald-400 pointer-events-none">
                  <ShieldCheck className="w-24 h-24" />
                </div>

                <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                  <Store className="w-4 h-4 text-emerald-400" />
                  Melhor preço disponível em{' '}
                  <strong className="text-white font-bold">{bestListing?.storeName || 'Loja Parceira'}</strong>:
                </div>

                <div className="flex items-baseline gap-3 mb-2">
                  <span className="text-3xl sm:text-4xl font-black text-white">
                    {formatCurrency(deal.currentBestPrice)}
                  </span>
                  {bestListing?.originalPrice && bestListing.originalPrice > deal.currentBestPrice && (
                    <span className="text-sm text-slate-500 line-through">
                      {formatCurrency(bestListing.originalPrice)}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-400 mb-6 flex items-center gap-4">
                  <span>
                    Média de 30 dias:{' '}
                    <strong className="text-cyan-400">{formatCurrency(deal.averagePrice30d)}</strong>
                  </span>
                  <span>
                    Menor histórico:{' '}
                    <strong className="text-emerald-400">{formatCurrency(deal.lowestPriceEver)}</strong>
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <a
                    href={bestListing?.affiliateUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 font-extrabold text-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition cursor-pointer"
                  >
                    <span>Ir para {bestListing?.storeName || 'Loja'}</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  <button
                    onClick={() => setAlertOpen(true)}
                    className="w-full sm:w-auto py-3.5 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm flex items-center justify-center gap-2 border border-slate-700 transition cursor-pointer"
                  >
                    <Bell className="w-4 h-4 text-emerald-400" />
                    <span>Criar Alerta de Preço</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comparativo Lado a Lado de Todas as Lojas */}
        <section className="mb-12">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-400" />
            <span>Comparador de Preços em Todas as Lojas ({deal.listings.length})</span>
          </h2>

          <div className="bg-[#0e121a] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="divide-y divide-slate-800/80">
              {deal.listings.map((l, index) => {
                const isWinner = index === 0;
                return (
                  <div
                    key={l.id}
                    className={`p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
                      isWinner ? 'bg-emerald-500/5' : 'hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 shrink-0">
                        {l.storeName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-sm">{l.storeName}</h4>
                          {isWinner && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[#25D366] text-[10px] font-black border border-emerald-500/40">
                              🏆 MENOR PREÇO
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {l.source} • Estoque confirmado
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                      <div className="text-left sm:text-right">
                        <div className="text-lg font-black text-white">
                          {formatCurrency(l.currentPrice)}
                        </div>
                        {l.originalPrice && l.originalPrice > l.currentPrice && (
                          <div className="text-xs text-slate-500 line-through">
                            {formatCurrency(l.originalPrice)}
                          </div>
                        )}
                      </div>

                      <a
                        href={l.affiliateUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                          isWinner
                            ? 'bg-emerald-500 text-black hover:bg-emerald-600'
                            : 'bg-slate-800 hover:bg-slate-700 text-white'
                        }`}
                      >
                        <span>Acessar Loja</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Gráfico do Histórico de Preços */}
        <section className="mb-12">
          <PriceHistoryChart
            history={deal.priceHistory}
            averagePrice={deal.averagePrice30d}
            lowestPrice={deal.lowestPriceEver}
            currentPrice={deal.currentBestPrice}
          />
        </section>
      </main>

      <PriceAlertModal
        isOpen={alertOpen}
        onClose={() => setAlertOpen(false)}
        productSlug={deal.slug}
        productTitle={deal.cleanTitle}
        currentPrice={deal.currentBestPrice}
      />

      <LandingFooter />
    </div>
  );
}
