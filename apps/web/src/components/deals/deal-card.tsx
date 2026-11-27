'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Bell, TrendingDown, Store, Flame, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { offerRedirectHref, useTrackQuery } from '@/lib/offer-redirect';
import { ProductImage } from '@/components/ui/product-image';
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
    badge: 'ALL_TIME_LOW' | 'GREAT_DEAL' | 'FAIR_PRICE' | 'INFLATED_DISCOUNT' | 'TRACKING';
    badgeLabel: string;
    averagePrice: number;
    lowestPriceEver: number;
    realDiscountPct: number;
    isRealPromotion: boolean;
    hasHistory?: boolean;
    trackingSince?: string | null;
    storeDiscountPct?: number;
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

  const trackQuery = useTrackQuery();
  const affiliateLink = deal.bestListing?.affiliateUrl
    ? offerRedirectHref(deal.bestListing.id, trackQuery)
    : `/ofertas/${deal.slug}`;

  return (
    <>
      <article className="group relative flex flex-col justify-between bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl p-4 shadow-xs hover:shadow-md transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]">
        <div>
          {/* Top Badges */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {isAllTimeLow ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold tracking-tight">
                <Flame className="w-3.5 h-3.5 text-emerald-600" />
                Menor preço
              </span>
            ) : isGreatDeal ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-semibold">
                <Sparkles className="w-3 h-3" />
                {deal.analysis.badgeLabel}
              </span>
            ) : isInflated ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold">
                Desconto inflado
              </span>
            ) : (
              <span className="text-[11px] font-medium text-slate-500 truncate">
                {deal.brand ?? deal.category ?? 'Oferta'}
              </span>
            )}

            <button
              type="button"
              onClick={() => setAlertOpen(true)}
              className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors duration-150 cursor-pointer active:scale-95"
              title="Criar alerta de preço para este produto"
              aria-label="Criar alerta"
            >
              <Bell className="w-4 h-4" />
            </button>
          </div>

          {/* Imagem do Produto */}
          <Link
            href={`/ofertas/${deal.slug}`}
            className="block relative aspect-square w-full rounded-xl bg-white overflow-hidden mb-3 p-3"
          >
            <ProductImage
              src={deal.imageUrl}
              alt={deal.cleanTitle}
              className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              placeholderClassName="rounded-lg bg-slate-100 text-slate-400"
            />
          </Link>

          {/* Título */}
          <Link href={`/ofertas/${deal.slug}`}>
            <h3 className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors duration-150 line-clamp-2 mb-2 leading-snug">
              {deal.cleanTitle}
            </h3>
          </Link>

          {/* Comparativo de lojas */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <Store className="w-3 h-3 text-slate-400" />
              {deal.listingsCount} {deal.listingsCount === 1 ? 'loja' : 'lojas'}
            </span>
            {deal.availableStores.slice(0, 2).map((st, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] text-slate-600 font-medium"
              >
                {st.storeName}
              </span>
            ))}
          </div>
        </div>

        {/* Preço e Botões de Ação */}
        <div className="pt-3 border-t border-slate-100">
          <div className="mb-3">
            <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2 mb-0.5">
              <span className="truncate">Em {deal.bestListing?.storeName || 'Loja'}</span>
              {deal.analysis.realDiscountPct > 0 ? (
                <span
                  className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold tabular-nums shrink-0"
                  title="Desconto contra o histórico de preços"
                >
                  -{deal.analysis.realDiscountPct}%
                </span>
              ) : (deal.analysis.storeDiscountPct ?? 0) > 0 ? (
                <span
                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold tabular-nums shrink-0"
                  title="Desconto informado pela loja (ainda sem histórico para confirmar)"
                >
                  -{deal.analysis.storeDiscountPct}% na loja
                </span>
              ) : null}
            </div>
            <div className="text-xl font-bold tracking-tight text-slate-900 flex items-baseline gap-2 tabular-nums">
              <span>{formatCurrency(deal.currentBestPrice)}</span>
              {deal.bestListing?.originalPrice && deal.bestListing.originalPrice > deal.currentBestPrice && (
                <span className="text-xs text-slate-400 line-through font-normal">
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
              className="col-span-4 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer"
            >
              <span>Pegar oferta</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <Link
              href={`/ofertas/${deal.slug}`}
              className="col-span-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-[background-color,transform] duration-150 active:scale-[0.97]"
              title="Ver histórico e comparador"
              aria-label="Ver histórico e comparador"
            >
              <TrendingDown className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </article>

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
