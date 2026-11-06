'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Flame,
  Smartphone,
  Tag,
  Laptop,
  Home,
  Headphones,
  AlertCircle,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { AffiliateNav } from '@/components/affiliate-landing/affiliate-nav';
import { AffiliateHero } from '@/components/affiliate-landing/affiliate-hero';
import { AffiliateGroups, type AffiliateGroupLink } from '@/components/affiliate-landing/affiliate-groups';
import { AffiliateAuthority } from '@/components/affiliate-landing/affiliate-authority';
import { AffiliateFaq } from '@/components/affiliate-landing/affiliate-faq';
import { AffiliateFooter } from '@/components/affiliate-landing/affiliate-footer';
import { getThemeStyles } from '@/components/affiliate-landing/theme';

interface LandingProfile {
  id: string;
  slug: string;
  title: string;
  authorName: string;
  authorBadge: string;
  authorBio: string | null;
  authorImage: string | null;
  logoText: string;
  themeColor: string;
  headline: string;
  subheadline: string;
  ctaButtonText: string;
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  stat3Value: string;
  stat3Label: string;
  stat4Value: string;
  stat4Label: string;
  youtubeUrl: string | null;
  instagramUrl: string | null;
  telegramUrl: string | null;
  showBenefits: boolean;
  showAuthority: boolean;
  showCategories: boolean;
  showFaq: boolean;
}

const CATEGORIES_MATRIX = [
  {
    code: 'M 01',
    title: 'Geral & Bugs de Preço',
    desc: 'O canal mais urgente. Quedas repentinas de preço, erros de precificação das lojas e as maiores ofertas do dia reunidas em tempo real.',
    icon: Flame,
    color: 'text-red-500',
  },
  {
    code: 'M 02',
    title: 'Smartphones & Celulares',
    desc: 'Linhas Samsung Galaxy, iPhones, Xiaomi, Motorola e dobráveis. Alertas com o menor preço histórico e cupons.',
    icon: Smartphone,
    color: 'text-cyan-400',
  },
  {
    code: 'M 03',
    title: 'Cupons & Descontos Secretos',
    desc: 'Cupons exclusivos de Mercado Livre, Amazon, Shopee, Magalu e KaBuM testados e validados minuto a minuto.',
    icon: Tag,
    color: 'text-amber-400',
  },
  {
    code: 'M 04',
    title: 'Notebooks & Informática',
    desc: 'Laptops para produtividade, MacBooks, monitores ultrawide, peças de hardware e periféricos gamer com descontos agressivos.',
    icon: Laptop,
    color: 'text-blue-400',
  },
  {
    code: 'M 05',
    title: 'Casa Inteligente & Eletro',
    desc: 'Air fryers, aspiradores robô, máquinas lava e seca, cafeteiras, Smart TVs 4K e dispositivos smart home.',
    icon: Home,
    color: 'text-emerald-400',
  },
  {
    code: 'M 06',
    title: 'Áudio & Wearables',
    desc: 'Fones bluetooth com cancelamento ativo de ruído, soundbars, caixas de som JBL e smartwatches com procedência.',
    icon: Headphones,
    color: 'text-purple-400',
  },
];

export default function AffiliateLandingPage() {
  const params = useParams();
  const slug = (params?.slug as string) || '';

  const [profile, setProfile] = useState<LandingProfile | null>(null);
  const [groups, setGroups] = useState<AffiliateGroupLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function fetchLanding() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/v1/public/affiliate-landing/${slug}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Esta página de ofertas não existe ou foi temporariamente pausada.');
          } else {
            setError('Não foi possível carregar as informações desta página.');
          }
          return;
        }

        const json = await res.json();
        if (json.ok && json.data) {
          setProfile(json.data.profile);
          setGroups(json.data.groups || []);
          if (json.data.profile?.title) {
            document.title = json.data.profile.title;
          }
        } else {
          setError('Página não encontrada.');
        }
      } catch (err) {
        setError('Ocorreu uma falha de conexão ao carregar a página.');
      } finally {
        setLoading(false);
      }
    }

    fetchLanding();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
        <span className="font-mono text-xs text-slate-400 uppercase tracking-widest">
          Carregando comunidade VIP...
        </span>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[#07090e] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full p-8 rounded-3xl bg-[#0b0e14] border border-white/10 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-white uppercase tracking-wide">Página Indisponível</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            {error || 'Não foi possível encontrar a comunidade solicitada.'}
          </p>
          <div className="pt-4">
            <Link
              href="/landpage"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs uppercase tracking-wider transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Ir para a Página Principal</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const theme = getThemeStyles(profile.themeColor);

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 font-sans selection:bg-red-600 selection:text-white relative overflow-x-hidden">
      {/* Top Navbar */}
      <AffiliateNav
        logoText={profile.logoText}
        themeColor={profile.themeColor}
        showBenefits={profile.showBenefits}
        showAuthority={profile.showAuthority}
        showCategories={profile.showCategories}
        showFaq={profile.showFaq}
      />

      {/* Dobra 1: Hero */}
      <AffiliateHero
        authorName={profile.authorName}
        authorBadge={profile.authorBadge}
        authorImage={profile.authorImage}
        headline={profile.headline}
        subheadline={profile.subheadline}
        ctaButtonText={profile.ctaButtonText}
        themeColor={profile.themeColor}
      />

      {/* Seção 2: Para quem é a nossa comunidade? (Opcional) */}
      {profile.showBenefits && (
        <section id="para-quem" className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
          <div className="mb-12">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-3`}
            >
              <span>[ CRITÉRIOS DE ADMISSÃO ]</span>
            </div>
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight">
              PARA QUEM É A NOSSA COMUNIDADE?
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div
              className={`p-7 rounded-2xl bg-[#0b0e14] border border-white/10 ${theme.cardBorderHover} transition-all duration-300 shadow-xl group`}
            >
              <div className={`text-xs font-mono ${theme.accentText} mb-4 font-black tracking-widest`}>
                [ 01 ]
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-slate-200 transition-colors">
                Quem quer comprar pagando o menor valor real
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Cansado da falsa "metade do dobro"? Nossa equipe e algoritmos acompanham os históricos para garantir que cada oferta postada seja economia de verdade.
              </p>
            </div>

            <div
              className={`p-7 rounded-2xl bg-[#0b0e14] border border-white/10 ${theme.cardBorderHover} transition-all duration-300 shadow-xl group`}
            >
              <div className={`text-xs font-mono ${theme.accentText} mb-4 font-black tracking-widest`}>
                [ 02 ]
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-slate-200 transition-colors">
                Caçadores de Cupons Secretos & Bugs
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Erros de precificação e cupons relâmpago de 30%, 50% e 70% costumam durar poucos minutos. Quem está no grupo é alertado na hora e garante antes de esgotar.
              </p>
            </div>

            <div
              className={`p-7 rounded-2xl bg-[#0b0e14] border border-white/10 ${theme.cardBorderHover} transition-all duration-300 shadow-xl group`}
            >
              <div className={`text-xs font-mono ${theme.accentText} mb-4 font-black tracking-widest`}>
                [ 03 ]
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white mb-3 group-hover:text-slate-200 transition-colors">
                Compradores que exigem segurança total
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                A internet está cheia de golpes e clones. Todos os links compartilhados por {profile.authorName} direcionam para as grandes lojas oficiais verificadas do país.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Seção 3: Autoridade & Números (Opcional) */}
      {profile.showAuthority && (
        <AffiliateAuthority
          authorName={profile.authorName}
          authorBio={profile.authorBio}
          stat1Value={profile.stat1Value}
          stat1Label={profile.stat1Label}
          stat2Value={profile.stat2Value}
          stat2Label={profile.stat2Label}
          stat3Value={profile.stat3Value}
          stat3Label={profile.stat3Label}
          stat4Value={profile.stat4Value}
          stat4Label={profile.stat4Label}
          youtubeUrl={profile.youtubeUrl}
          instagramUrl={profile.instagramUrl}
          telegramUrl={profile.telegramUrl}
          themeColor={profile.themeColor}
        />
      )}

      {/* Seção 4: Matriz de Categorias (Opcional) */}
      {profile.showCategories && (
        <section id="categorias" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/10">
          <div className="mb-14">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-md ${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-xs font-mono font-bold uppercase tracking-wider mb-3`}
            >
              <span>[ MATRIZ DE CATEGORIAS ]</span>
            </div>
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight mb-3">
              O QUE VOCÊ VAI RECEBER NOS GRUPOS
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-2xl">
              Canais setorizados com curadoria para você acompanhar apenas as ofertas que interessam ao seu dia a dia.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CATEGORIES_MATRIX.map((cat, idx) => {
              const Icon = cat.icon;
              return (
                <div
                  key={idx}
                  className={`relative p-7 rounded-2xl bg-[#0b0e14] border border-white/10 ${theme.cardBorderHover} transition-all duration-300 shadow-xl group flex flex-col justify-between`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className={`text-xs font-mono font-black ${theme.accentText} tracking-wider`}>
                        {cat.code}
                      </span>
                      <Icon className={`w-5 h-5 ${cat.color}`} />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2 group-hover:text-slate-200 transition-colors">
                      {cat.title}
                    </h3>
                    <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                      {cat.desc}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-slate-500">
                    <span>WHATSAPP VIP</span>
                    <span className="text-emerald-400 font-bold">ATIVO</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Seção 5: Lista Interativa dos Grupos VIP do Afiliado */}
      <AffiliateGroups
        groups={groups}
        authorName={profile.authorName}
        themeColor={profile.themeColor}
      />

      {/* Seção 6: FAQ (Opcional) */}
      {profile.showFaq && (
        <AffiliateFaq
          authorName={profile.authorName}
          themeColor={profile.themeColor}
        />
      )}

      {/* Rodapé */}
      <AffiliateFooter authorName={profile.authorName} />
    </div>
  );
}
