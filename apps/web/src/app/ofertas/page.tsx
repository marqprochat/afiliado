'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Flame, ShieldCheck, RefreshCw, ArrowRight, X, MessageCircle } from 'lucide-react';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { DealCard, type DealCardProps } from '@/components/deals/deal-card';

export default function OfertasPage() {
  const [deals, setDeals] = useState<DealCardProps[]>([]);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [allTimeLowOnly, setAllTimeLowOnly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  function loadDeals() {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (selectedCategory !== 'ALL') params.set('category', selectedCategory);
    if (allTimeLowOnly) params.set('allTimeLowOnly', 'true');

    fetch(`/api/v1/deals?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { deals: [] }))
      .then((data) => {
        setDeals(data.deals || []);
        setLoading(false);
      })
      .catch(() => {
        setDeals([]);
        setLoading(false);
      });
  }

  function loadCategories() {
    fetch('/api/v1/deals/categories')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(data))
      .catch(() => {});
  }

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadDeals();
  }, [searchQuery, selectedCategory, allTimeLowOnly]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-600 selection:text-white flex flex-col">
      <LandingNav minimal />

      {/* Storefront Header & Search */}
      <section className="bg-white border-b border-slate-200 pt-24 pb-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                <span>Monitoramento multi-lojas auditado</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Ofertas verificadas
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Comparativo em tempo real entre Amazon, Shopee, Mercado Livre, Awin e Magalu.
              </p>
            </div>

            {/* Busca */}
            <div className="w-full lg:max-w-md relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar iPhone, Smart TV, Air Fryer, Notebook..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-900 rounded-xl text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Filtros em Pílulas */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setAllTimeLowOnly(!allTimeLowOnly)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                allTimeLowOnly
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Menor preço histórico</span>
            </button>

            <div className="h-4 w-[1px] bg-slate-200 shrink-0 mx-0.5" />

            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer border ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              Todas
            </button>

            {categories.map((c) => (
              <button
                key={c.category}
                type="button"
                onClick={() => setSelectedCategory(c.category)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer border tabular-nums ${
                  selectedCategory === c.category
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {c.category} <span className="opacity-65">({c.count})</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Grid de Ofertas */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mb-3" />
            <p className="text-sm font-medium">Consultando os melhores preços em tempo real...</p>
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl p-8 max-w-lg mx-auto">
            <ShieldCheck className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-900 mb-1.5">Nenhuma oferta encontrada no momento</h3>
            <p className="text-slate-500 text-xs mb-6 leading-relaxed">
              Tente ajustar os filtros ou volte em instantes para conferir novas ofertas.
            </p>
            {(searchQuery || selectedCategory !== 'ALL' || allTimeLowOnly) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setAllTimeLowOnly(false);
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}

        {/* CTA Grupos VIP */}
        <div className="mt-12 p-6 sm:p-8 rounded-2xl bg-white border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shrink-0">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Receba essas ofertas antes de todo mundo
              </h3>
              <p className="text-slate-500 text-sm mt-0.5 max-w-xl">
                Entre gratuitamente nos nossos Grupos VIP de WhatsApp e receba quedas de preço e cupons verificados em primeira mão.
              </p>
            </div>
          </div>

          <Link
            href="/landpage"
            className="shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-[background-color,transform] duration-150 active:scale-[0.98]"
          >
            <span>Ver Grupos VIP</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>

      <LandingFooter minimal />
    </div>
  );
}
