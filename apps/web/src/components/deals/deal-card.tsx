'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Bell, TrendingDown, Store, Flame, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { PriceAlertModal } from './price-alert-modal';

export interface DealCardProps {
  id: string;
  title: string;
  cleanTitle: string;
  slug: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
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
  bestListing?: {
    id: string;
    source: string;
    storeName: string;
    currentPrice: number;
    originalPrice?: number | null;
    discountPct?: number | null;
    affiliateUrl?: string | null;
  } | null;
  availableStores: {
    storeName: string;
    source: string;
    price: number;
    url?: string | null;
  }[];
}

export function DealCard({ deal }: { deal: DealCardProps }) {
  const [alertOpen, setAlertOpen] = useState(false);

  const isAllTimeLow = deal.analysis.badge === 'ALL_TIME_LOW';
  const isGreatDeal = deal.analysis.badge === 'GREAT_DEAL';
  const isInflated = deal.analysis.badge === 'INFLATED_DISCOUNT';

  const affiliateLink = deal.bestListing?.affiliateUrl || `/ofertas/${deal.slug}`;

  return (
    <>
      <div className="group relative flex flex-col justify-between bg-gradient-to-b from-[#121722] to-[#0e121a] border border-slate-800/80 hover:border-emerald-500/50 rounded-2xl p-4 shadow-lg hover:shadow-emerald-500/10 transition-all duration-300">
        <div>
          {/* Top Badges */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {isAllTimeLow ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[#25D366] text-[11px] font-black uppercase tracking-wider animate-pulse">
                <Flame className="w-3.5 h-3.5 text-[#25D366]" />
                Mínima Histórica
              </span>
            ) : isGreatDeal ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[11px] font-bold">
                <Sparkles className="w-3 h-3" />
                {deal.analysis.badgeLabel}
              </span>
            ) : isInflated ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">
                Desconto Inflado
              </span>
            ) : (
              <span className="text-[11px] font-medium text-slate-400">
                {deal.brand ?? deal.category ?? 'Oferta'}
              </span>
            )}

            <button
              onClick={() => setAlertOpen(true)}
              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition"
              title="Criar alerta de preço para este produto"
              aria-label="Criar alerta"
            >
              <Bell className="w-4 h-4" />
            </button>
          </div>

          {/* Imagem do Produto */}
          <Link href={`/ofertas/${deal.slug}`} className="block relative aspect-square w-full rounded-xl bg-black/40 border border-slate-800/60 overflow-hidden mb-3 p-3">
            {deal.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={deal.imageUrl}
                alt={deal.cleanTitle}
                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                Sem foto
              </div>
            )}
          </Link>

          {/* Título */}
          <Link href={`/ofertas/${deal.slug}`}>
            <h3 className="text-sm font-semibold text-slate-100 group-hover:text-emerald-400 transition line-clamp-2 mb-2 leading-snug">
              {deal.cleanTitle}
            </h3>
          </Link>

          {/* Comparativo de lojas */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Store className="w-3 h-3 text-slate-500" />
              {deal.listingsCount} {deal.listingsCount === 1 ? 'loja' : 'lojas'}:
            </span>
            {deal.availableStores.slice(0, 3).map((st, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 text-[10px] text-slate-300 font-medium"
              >
                {st.storeName}
              </span>
            ))}
          </div>
        </div>

        {/* Preço e Botões de Ação */}
        <div className="pt-2 border-t border-slate-800/60">
          <div className="mb-2">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Menor preço em {deal.bestListing?.storeName || 'Loja'}:</span>
              {deal.analysis.realDiscountPct > 0 && (
                <span className="text-emerald-400 font-bold">
                  -{deal.analysis.realDiscountPct}%
                </span>
              )}
            </div>
            <div className="text-lg font-black text-white flex items-baseline gap-1.5">
              <span>{formatCurrency(deal.currentBestPrice)}</span>
              {deal.bestListing?.originalPrice && deal.bestListing.originalPrice > deal.currentBestPrice && (
                <span className="text-xs text-slate-500 line-through font-normal">
                  {formatCurrency(deal.bestListing.originalPrice)}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2">
            <a
              href={affiliateLink}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-4 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition cursor-pointer"
            >
              <span>Pegar Oferta</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <Link
              href={`/ofertas/${deal.slug}`}
              className="col-span-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Ver histórico e comparador"
            >
              <TrendingDown className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      <PriceAlertModal
        isOpen={alertOpen}
        onClose={() => setAlertOpen(false)}
        productSlug={deal.slug}
        productTitle={deal.cleanTitle}
        currentPrice={deal.currentBestPrice}
      />
    </>
  );
}
