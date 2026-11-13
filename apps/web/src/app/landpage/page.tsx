import React from 'react';
import type { Metadata } from 'next';
import { AuraLandingView } from '@/components/aura-landing/AuraLandingView';
import {
  AURA_DEFAULT_HERO_IMAGE,
  AURA_DEFAULT_NICHES,
  AURA_DEFAULT_STEPS,
  AURA_DEFAULT_FAQS,
  mapGroupLinkToAuraNiche,
  type GroupLinkLike,
} from '@afilados/shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export const metadata: Metadata = {
  title: 'Clube de Preços VIP · Grupos de Ofertas e Cupons no WhatsApp',
  description:
    'Rastreamos bugs de preço, descontos relâmpago e promoções exclusiva em grandes lojas. Escolha seu nicho e entre no grupo do WhatsApp!',
};

export default async function LandpagePage() {
  let niches = AURA_DEFAULT_NICHES;
  let generalUrl = 'https://chat.whatsapp.com/invite/exemplo-grupo-vip-geral';

  try {
    const res = await fetch(`${API_URL}/api/v1/public/affiliate-landing/exemplo`, {
      cache: 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data?.data?.niches) && data.data.niches.length > 0) {
        niches = data.data.niches;
        if (data.data.profile?.whatsappGeneralUrl) {
          generalUrl = data.data.profile.whatsappGeneralUrl;
        } else if (niches[0]?.whatsappLink) {
          generalUrl = niches[0].whatsappLink;
        }
      }
    }
  } catch {
    niches = AURA_DEFAULT_NICHES;
  }

  const exampleProfile = {
    title: 'Clube de Preços VIP · Grupos de Ofertas e Cupons no WhatsApp',
    authorName: 'Clube de Preços VIP',
    logoText: 'CLUBE DE PREÇOS VIP',
    themeColor: 'rose' as const,
    themeMode: 'light' as const,
    buttonColor: 'emerald' as const,

    heroImage: AURA_DEFAULT_HERO_IMAGE,
    badgeText: 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
    headline: 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
    subheadline:
      'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
    floatingBadgeText: `${niches.length} Nichos Disponíveis no WhatsApp`,
    ctaButtonText: 'Entrar no Grupo do WhatsApp',
    reassuranceText:
      '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
    whatsappGeneralUrl: generalUrl,

    howItWorksTitle: 'Como funcionam os nossos grupos de preço',
    howItWorksSubtitle:
      'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
    howItWorksSteps: AURA_DEFAULT_STEPS,

    faqTitle: 'Tudo o que você precisa saber sobre os grupos',
    faqSubtitle: 'Respostas diretas e transparentes para você entrar com total tranquilidade.',
    faqItems: AURA_DEFAULT_FAQS,
    faqBannerTitle: 'Quer entrar no Grupo Geral com todos os nichos juntos?',
    faqBannerText:
      'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
    faqBannerButtonText: 'Entrar no WhatsApp Geral',

    footerText:
      'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',

    showHowItWorks: true,
    showFaq: true,
    showNiches: true,
  };

  return (
    <AuraLandingView
      profile={exampleProfile}
      niches={niches}
      allowThemeToggle={true}
    />
  );
}
