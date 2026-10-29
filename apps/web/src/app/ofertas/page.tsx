'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Flame, Sparkles, Filter, ShieldCheck, RefreshCw, ArrowRight, Database } from 'lucide-react';
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
  const [syncing, setSyncing] = useState<boolean>(false);

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

  async function handleManualSync() {
    setSyncing(true);
    try {
      await fetch('/api/v1/deals/sync', { method: 'POST' });
      loadCategories();
      loadDeals();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080a0f] text-slate-100 font-sans selection:bg-[#25D366] selection:text-black flex flex-col">
      <LandingNav />

      {/* Hero Section */}
      <section className="pt-28 pb-10 px-4 sm:px-6 max-w-6xl mx-auto w-full text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[#25D366] text-xs font-black uppercase tracking-wider mb-4">
          <Flame className="w-4 h-4 text-[#25D366] animate-pulse" />
          <span>Monitoramento Inteligente Multi-Lojas</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4 max-w-3xl mx-auto leading-tight">
          Menores Preços <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-[#25D366] to-cyan-400">Reais e Auditados</span> de Toda a Internet
        </h1>

        <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto mb-8">
          Comparamos Amazon, Shopee, Mercado Livre, Awin e Magalu para você nunca cair em desconto falso. Crie alertas de preço e receba no WhatsApp!
        </p>

        {/* Barra de Pesquisa e Filtros Rápidos */}
        <div className="max-w-2xl mx-auto relative mb-6">
          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
            <input
              type="text"
              placeholder="Buscar por iPhone, Smart TV, Air Fryer, Notebook..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-[#121622] border border-slate-800 hover:border-emerald-500/50 focus:border-emerald-500 rounded-2xl text-white text-sm shadow-xl focus:outline-none transition"
            />
          </div>
        </div>

        {/* Filtros em Pílulas */}
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl mx-auto">
          <button
            onClick={() => setAllTimeLowOnly(!allTimeLowOnly)}
            className={`px-3 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer border ${
              allTimeLowOnly
                ? 'bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/20'
                : 'bg-[#121622] text-slate-300 border-slate-800 hover:border-emerald-500/40'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            🔥 Só Menor Preço Histórico
          </button>

          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer border ${
              selectedCategory === 'ALL'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[#121622] text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            Todas as Categorias
          </button>

          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => setSelectedCategory(c.category)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer border ${
                selectedCategory === c.category
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-[#121622] text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              {c.category} ({c.count})
            </button>
          ))}

          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer border bg-slate-800/80 text-slate-300 border-slate-700 hover:text-emerald-400 hover:border-emerald-500/40 flex items-center gap-1.5 disabled:opacity-50"
            title="Sincronizar produtos importados de Marketplaces e Awin"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{syncing ? 'Sincronizando...' : 'Atualizar Catálogo'}</span>
          </button>
        </div>
      </section>

      {/* Grid de Ofertas */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pb-16">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
            <p className="text-sm font-semibold">Consultando os melhores preços em tempo real...</p>
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-16 bg-[#121622]/50 border border-slate-800 rounded-3xl p-8 max-w-lg mx-auto">
            <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white mb-2">Nenhum produto exibido no momento</h3>
            <p className="text-slate-400 text-xs mb-6 leading-relaxed">
              Você já importou produtos ou catálogo da Awin? Clique no botão abaixo para indexar e carregar todos os produtos existentes agora mesmo na vitrine!
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-black font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Carregando Produtos...' : 'Sincronizar Meus Produtos Importados'}</span>
              </button>

              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setAllTimeLowOnly(false);
                }}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Limpar Filtros
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}

        {/* CTA Grupos VIP */}
        <div className="mt-16 p-8 rounded-3xl bg-gradient-to-r from-[#121722] via-[#101920] to-[#121722] border border-emerald-500/30 text-center relative overflow-hidden shadow-2xl">
          <div className="relative z-10 max-w-xl mx-auto">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[#25D366]/20 text-[#25D366] flex items-center justify-center border border-[#25D366]/40">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-black text-white mb-2">
              Quer receber essas ofertas antes de todo mundo?
            </h3>
            <p className="text-slate-300 text-xs sm:text-sm mb-6">
              Entre gratuitamente nos nossos Grupos VIP de WhatsApp e receba bugs de preço e cupons exclusivos em primeira mão.
            </p>
            <Link
              href="/landpage"
              className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-black font-extrabold text-sm rounded-xl shadow-lg shadow-emerald-500/25 transition cursor-pointer"
            >
              <span>Ver Grupos Oficiais do WhatsApp</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
