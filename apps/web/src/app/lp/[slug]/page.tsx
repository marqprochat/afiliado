'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { AuraLandingView, type AuraLandingProfileData } from '@/components/aura-landing/AuraLandingView';
import type { AuraNicheItem } from '@afilados/shared';

export default function AffiliateLandingPage() {
  const params = useParams();
  const slug = (params?.slug as string) || '';

  const [profile, setProfile] = useState<AuraLandingProfileData | null>(null);
  const [niches, setNiches] = useState<AuraNicheItem[]>([]);
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
          setNiches(json.data.niches || []);
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
      <div className="min-h-screen bg-[#FFFBFD] dark:bg-[#090b10] text-neutral-900 dark:text-slate-100 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-rose-500 animate-spin" />
        <span className="font-mono text-xs text-neutral-500 uppercase tracking-widest">
          Carregando Clube VIP...
        </span>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[#FFFBFD] dark:bg-[#090b10] text-neutral-900 dark:text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full p-8 rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-slate-800 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Página Indisponível</h2>
          <p className="text-sm text-neutral-600 dark:text-slate-300">
            {error || 'Não foi possível encontrar a página solicitada.'}
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar para o início
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuraLandingView
      profile={profile}
      niches={niches}
      allowThemeToggle={false}
    />
  );
}
