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
  Share2,
} from 'lucide-react';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { PriceHistoryChart } from '@/components/deals/price-history-chart';
import { PriceAlertModal } from '@/components/deals/price-alert-modal';
import { DealCouponBlock, type DealCoupon } from '@/components/deals/deal-coupon-block';
import { ProductImage } from '@/components/ui/product-image';
import { formatCurrency } from '@/lib/format';
import { offerRedirectHref, useTrackQuery } from '@/lib/offer-redirect';

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
  coupons?: DealCoupon[];
}

export default function OfertaDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const trackQuery = useTrackQuery();

  async function handleShare() {
    if (!deal) return;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const text = `${deal.cleanTitle} por ${formatCurrency(deal.currentBestPrice)} — veja o histórico de preços:`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: deal.cleanTitle, text, url });
        return;
      } catch {
        // usuário cancelou ou fallback para clipboard
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard && url) {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  }

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
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
        <LandingNav minimal />
        <div className="flex flex-col items-center justify-center py-40">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mb-4" />
          <p className="text-slate-500 text-sm">Carregando comparador e histórico de preços...</p>
        </div>
        <LandingFooter minimal />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
        <LandingNav minimal />
        <div className="text-center py-40 max-w-md mx-auto px-4">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Produto não encontrado</h2>
          <p className="text-slate-500 text-sm mb-6">
            O link pode estar expirado ou o produto foi removido.
          </p>
          <Link
            href="/ofertas"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para a vitrine de ofertas
          </Link>
        </div>
        <LandingFooter minimal />
      </div>
    );
  }

  // Produto sem nenhuma loja em estoque (o link pode ter sido postado antes): o preço gravado
  // ficou velho e não há onde comprar, então não mostra preço nem botão de compra.
  if (deal.listings.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
        <LandingNav minimal />
        <main className="flex-1 max-w-md mx-auto w-full px-4 pt-28 pb-16 text-center">
          {deal.imageUrl && (
            <div className="aspect-square w-full max-w-xs mx-auto rounded-2xl bg-white border border-slate-200 p-6 flex items-center justify-center mb-6 overflow-hidden opacity-80">
              <ProductImage
                src={deal.imageUrl}
                alt={deal.cleanTitle}
                loading="eager"
                className="w-full h-full object-contain"
                placeholderClassName="rounded-xl bg-slate-100 text-slate-400"
                iconClassName="h-12 w-12"
              />
            </div>
          )}
          <h1 className="text-xl font-bold text-slate-900 mb-3">{deal.cleanTitle}</h1>
          <p className="text-amber-700 font-semibold mb-2">Oferta indisponível no momento</p>
          <p className="text-slate-500 text-sm mb-6">
            Nenhuma loja tem este produto em estoque agora. Confira outras ofertas na vitrine.
          </p>
          <Link
            href="/ofertas"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Ver todas as ofertas
          </Link>
        </main>
        <LandingFooter minimal />
      </div>
    );
  }

  const bestListing = deal.listings[0] ?? null;
  const isAllTimeLow = deal.analysis.badge === 'ALL_TIME_LOW';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col justify-between">
      <LandingNav minimal />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-24 pb-16">
        {/* Navegação Topo */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-6">
          <Link href="/ofertas" className="hover:text-slate-900 transition-colors flex items-center gap-1 font-medium">
            <ArrowLeft className="w-3.5 h-3.5" />
            Todas as ofertas
          </Link>
          <span className="text-slate-300">/</span>
          <span>{deal.category ?? 'Produtos'}</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700 font-medium truncate max-w-xs">{deal.cleanTitle}</span>
        </div>

        {/* Bloco Principal do Produto */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-10">
          {/* Coluna Visual (Foto & Miniaturas) */}
          <div className="md:col-span-5 flex flex-col items-center">
            <div className="relative aspect-square w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6 flex items-center justify-center shadow-xs mb-3 overflow-hidden">
              <ProductImage
                src={selectedImage || deal.imageUrl}
                alt={deal.cleanTitle}
                loading="eager"
                className="w-full h-full object-contain"
                placeholderClassName="rounded-xl bg-slate-100 text-slate-400"
                iconClassName="h-12 w-12"
              />

              {isAllTimeLow && (
                <div className="absolute top-3.5 left-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-xs">
                  <Flame className="w-3.5 h-3.5 text-emerald-600" />
                  Menor preço histórico
                </div>
              )}
            </div>

            {deal.images && deal.images.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto max-w-sm py-1">
                {deal.images.slice(0, 5).map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImage(img)}
                    className={`relative w-14 h-14 rounded-xl bg-white border p-1.5 transition-colors cursor-pointer shrink-0 ${
                      selectedImage === img ? 'border-slate-900 shadow-xs' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <ProductImage
                      src={img}
                      alt=""
                      className="w-full h-full object-contain"
                      placeholderClassName="bg-slate-100 text-slate-400"
                      iconClassName="h-4 w-4"
                    />
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
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 text-xs font-semibold">
                    {deal.brand}
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  {deal.analysis.badgeLabel}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-5 leading-snug">
                {deal.cleanTitle}
              </h1>

              {/* Box de Menor Preço (Buy Box) */}
              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs mb-6">
                <div className="text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Store className="w-4 h-4 text-emerald-600" />
                  Melhor preço disponível em{' '}
                  <strong className="text-slate-900 font-semibold">{bestListing?.storeName || 'Loja Parceira'}</strong>
                </div>

                <div className="flex items-baseline gap-3 mb-4 tabular-nums">
                  <span className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                    {formatCurrency(deal.currentBestPrice)}
                  </span>
                  {bestListing?.originalPrice && bestListing.originalPrice > deal.currentBestPrice && (
                    <span className="text-sm text-slate-400 line-through">
                      {formatCurrency(bestListing.originalPrice)}
                    </span>
                  )}
                </div>

                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-600 mb-6 flex flex-wrap items-center gap-x-6 gap-y-1.5 tabular-nums">
                  <span>
                    Média de 30 dias:{' '}
                    <strong className="text-slate-900">{formatCurrency(deal.averagePrice30d)}</strong>
                  </span>
                  <span>
                    Menor histórico:{' '}
                    <strong className="text-emerald-700">{formatCurrency(deal.lowestPriceEver)}</strong>
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2.5">
                  <a
                    href={
                      bestListing?.affiliateUrl
                        ? offerRedirectHref(bestListing.id, trackQuery)
                        : '#'
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto flex-1 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold text-white text-sm flex items-center justify-center gap-2 transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    <span>Ir para {bestListing?.storeName || 'Loja'}</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  <button
                    type="button"
                    onClick={() => setAlertOpen(true)}
                    className="w-full sm:w-auto py-3 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2 border border-slate-300 transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    <Bell className="w-4 h-4 text-emerald-600" />
                    <span>Criar alerta</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShare}
                    title="Compartilhar oferta"
                    className="w-full sm:w-auto py-3 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 border border-slate-200 transition-[background-color,transform] duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 text-slate-500" />
                    <span>{copiedShare ? 'Copiado!' : 'Compartilhar'}</span>
                  </button>
                </div>
              </div>

              <DealCouponBlock coupons={deal.coupons ?? []} />
            </div>
          </div>
        </div>

        {/* Comparativo Lado a Lado de Todas as Lojas */}
        <section className="mb-10">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600" />
            <span>Comparador de preços ({deal.listings.length})</span>
          </h2>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="divide-y divide-slate-100">
              {deal.listings.map((l, index) => {
                const isWinner = index === 0;
                return (
                  <div
                    key={l.id}
                    className={`p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors ${
                      isWinner ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
                        {l.storeName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-slate-900 text-sm">{l.storeName}</h4>
                          {isWinner && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wide">
                              Menor preço
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {l.source} • Estoque confirmado
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">
                      <div className="text-left sm:text-right tabular-nums">
                        <div className="text-lg font-bold text-slate-900">
                          {formatCurrency(l.currentPrice)}
                        </div>
                        {l.originalPrice && l.originalPrice > l.currentPrice && (
                          <div className="text-xs text-slate-400 line-through">
                            {formatCurrency(l.originalPrice)}
                          </div>
                        )}
                      </div>

                      <a
                        href={l.affiliateUrl ? offerRedirectHref(l.id, trackQuery) : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`py-2 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-[background-color,transform] duration-150 active:scale-[0.98] ${
                          isWinner
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                        }`}
                      >
                        <span>Acessar loja</span>
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

      <LandingFooter minimal />
    </div>
  );
}
