import React from 'react';
import type { Metadata } from 'next';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { AuraLandingView, type AuraLandingProfileData } from '@/components/aura-landing/AuraLandingView';
import { getServerBaseUrl } from '@/lib/server-url';
import type { AuraNicheItem } from '@afilados/shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

interface PageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const slug = (resolvedParams?.slug || '').toLowerCase().trim();

  let title = 'Clube de Preços VIP · Ofertas e Cupons no WhatsApp';
  let description =
    'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!';
  let authorName = 'Clube VIP';

  try {
    const res = await fetch(`${API_URL}/api/v1/public/affiliate-landing/${slug}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json();
      const p = json?.data?.profile;
      if (p) {
        title = p.title || p.headline || title;
        description = p.subheadline || p.badgeText || description;
        authorName = p.authorName || authorName;
      }
    }
  } catch (err) {
    console.error('[generateMetadata lp/[slug]] erro ao buscar dados:', err);
  }

  const baseUrl = await getServerBaseUrl();
  const pageUrl = `${baseUrl}/lp/${slug}`;
  const ogImageUrl = `${baseUrl}/lp/${slug}/hero-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: pageUrl,
      siteName: authorName,
      locale: 'pt_BR',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function AffiliateLandingPage({ params }: PageProps) {
  const resolvedParams = await params;
  const slug = (resolvedParams?.slug || '').toLowerCase().trim();

  let profile: AuraLandingProfileData | null = null;
  let niches: AuraNicheItem[] = [];
  let error: string | null = null;

  try {
    const res = await fetch(`${API_URL}/api/v1/public/affiliate-landing/${slug}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 404) {
        error = 'Esta página de ofertas não existe ou foi temporariamente pausada.';
      } else {
        error = 'Não foi possível carregar as informações desta página.';
      }
    } else {
      const json = await res.json();
      if (json.ok && json.data) {
        profile = json.data.profile;
        niches = json.data.niches || [];
      } else {
        error = 'Página não encontrada.';
      }
    }
  } catch (err) {
    error = 'Ocorreu uma falha de conexão ao carregar a página.';
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
