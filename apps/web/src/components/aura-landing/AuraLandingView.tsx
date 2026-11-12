'use client';

import React, { useState } from 'react';
import type { AuraNicheItem, AuraStepItem, AuraFaqItem, ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';
import {
  AURA_DEFAULT_HERO_IMAGE,
  AURA_DEFAULT_NICHES,
  AURA_DEFAULT_STEPS,
  AURA_DEFAULT_FAQS,
} from '@afilados/shared';
import { AuraHeader } from './AuraHeader';
import { AuraHero } from './AuraHero';
import { AuraNicheGrid } from './AuraNicheGrid';
import { AuraHowItWorks } from './AuraHowItWorks';
import { AuraFaq } from './AuraFaq';
import { AuraFooter } from './AuraFooter';
import { AuraGroupModal } from './AuraGroupModal';
import { getAuraThemeStyles } from './theme';

export interface AuraLandingProfileData {
  title?: string | null;
  authorName?: string | null;
  logoText?: string | null;
  themeColor?: ThemeColor;
  themeMode?: ThemeMode;
  buttonColor?: ButtonColor;

  heroImage?: string | null;
  badgeText?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  floatingBadgeText?: string | null;
  ctaButtonText?: string | null;
  reassuranceText?: string | null;
  whatsappGeneralUrl?: string | null;

  howItWorksTitle?: string | null;
  howItWorksSubtitle?: string | null;
  howItWorksSteps?: AuraStepItem[] | null;

  faqTitle?: string | null;
  faqSubtitle?: string | null;
  faqItems?: AuraFaqItem[] | null;
  faqBannerTitle?: string | null;
  faqBannerText?: string | null;
  faqBannerButtonText?: string | null;

  footerText?: string | null;

  showHowItWorks?: boolean;
  showFaq?: boolean;
  showNiches?: boolean;
}

interface AuraLandingViewProps {
  profile: AuraLandingProfileData;
  niches?: AuraNicheItem[];
  allowThemeToggle?: boolean;
}

export const AuraLandingView: React.FC<AuraLandingViewProps> = ({
  profile,
  niches = AURA_DEFAULT_NICHES,
  allowThemeToggle = false,
}) => {
  const [currentMode, setCurrentMode] = useState<ThemeMode>(profile.themeMode || 'light');
  const [modalNiche, setModalNiche] = useState<AuraNicheItem | null>(null);

  const effectiveNiches = niches && niches.length > 0 ? niches : AURA_DEFAULT_NICHES;
  const [activeNicheId, setActiveNicheId] = useState<string>(effectiveNiches[0]?.id || 'beleza-cosmeticos');

  const themeColor = profile.themeColor || 'rose';
  const buttonColor = profile.buttonColor || 'emerald';
  const t = getAuraThemeStyles(themeColor, currentMode, buttonColor);

  const steps = profile.howItWorksSteps && profile.howItWorksSteps.length > 0
    ? profile.howItWorksSteps
    : AURA_DEFAULT_STEPS;

  const faqs = profile.faqItems && profile.faqItems.length > 0
    ? profile.faqItems
    : AURA_DEFAULT_FAQS;

  const heroImg = profile.heroImage || AURA_DEFAULT_HERO_IMAGE;

  const handleOpenGeneral = () => {
    if (profile.whatsappGeneralUrl) {
      window.open(profile.whatsappGeneralUrl, '_blank', 'noopener,noreferrer');
    } else {
      setModalNiche(effectiveNiches[0] || null);
    }
  };

  return (
    <div className={`min-h-screen ${t.bgMain} ${t.textMain} selection:bg-rose-500 selection:text-white antialiased transition-colors duration-200`}>
      {/* Top Header */}
      <AuraHeader
        logoText={profile.logoText || 'CLUBE DE PREÇOS VIP'}
        onJoinClick={handleOpenGeneral}
        themeColor={themeColor}
        themeMode={currentMode}
        buttonColor={buttonColor}
        showHowItWorks={profile.showHowItWorks !== false}
        showFaq={profile.showFaq !== false}
        showNiches={profile.showNiches !== false}
      />

      <main>
        {/* Hero Section */}
        <AuraHero
          heroImage={heroImg}
          badgeText={profile.badgeText}
          headline={profile.headline}
          subheadline={profile.subheadline}
          floatingBadgeText={profile.floatingBadgeText}
          ctaButtonText={profile.ctaButtonText}
          reassuranceText={profile.reassuranceText}
          niches={effectiveNiches}
          activeNicheId={activeNicheId}
          onSelectNiche={setActiveNicheId}
          onOpenModal={(n) => setModalNiche(n)}
          themeColor={themeColor}
          themeMode={currentMode}
          buttonColor={buttonColor}
        />

        {/* Niche Groups Cards Grid */}
        {profile.showNiches !== false && (
          <AuraNicheGrid
            niches={effectiveNiches}
            activeNicheId={activeNicheId}
            onSelectNiche={setActiveNicheId}
            onOpenModal={(n) => setModalNiche(n)}
            themeColor={themeColor}
            themeMode={currentMode}
            buttonColor={buttonColor}
          />
        )}

        {/* How It Works (3 Steps) */}
        {profile.showHowItWorks !== false && (
          <AuraHowItWorks
            title={profile.howItWorksTitle}
            subtitle={profile.howItWorksSubtitle}
            steps={steps}
            themeColor={themeColor}
            themeMode={currentMode}
            buttonColor={buttonColor}
          />
        )}

        {/* FAQ Accordion */}
        {profile.showFaq !== false && (
          <AuraFaq
            title={profile.faqTitle}
            subtitle={profile.faqSubtitle}
            faqs={faqs}
            bannerTitle={profile.faqBannerTitle}
            bannerText={profile.faqBannerText}
            bannerButtonText={profile.faqBannerButtonText}
            whatsappGeneralUrl={profile.whatsappGeneralUrl}
            themeColor={themeColor}
            themeMode={currentMode}
            buttonColor={buttonColor}
          />
        )}
      </main>

      {/* Footer */}
      <AuraFooter
        logoText={profile.logoText || 'CLUBE DE PREÇOS VIP'}
        footerText={profile.footerText}
        whatsappGeneralUrl={profile.whatsappGeneralUrl}
        themeColor={themeColor}
        themeMode={currentMode}
        buttonColor={buttonColor}
        showHowItWorks={profile.showHowItWorks !== false}
        showFaq={profile.showFaq !== false}
        showNiches={profile.showNiches !== false}
      />

      {/* Group Detail / Join Modal */}
      {modalNiche && (
        <AuraGroupModal
          isOpen={!!modalNiche}
          onClose={() => setModalNiche(null)}
          niche={modalNiche}
          themeColor={themeColor}
          themeMode={currentMode}
          buttonColor={buttonColor}
        />
      )}

      {/* Optional Theme Toggle Pill (útil na página exemplo /landpage) */}
      {allowThemeToggle && (
        <div className="fixed bottom-5 right-5 z-50">
          <button
            type="button"
            onClick={() => setCurrentMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
            className={`px-4 py-2 rounded-full text-xs font-bold shadow-xl border backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-2 ${
              currentMode === 'light'
                ? 'bg-neutral-900 text-white border-neutral-700'
                : 'bg-white text-neutral-900 border-rose-200'
            }`}
          >
            <span>Alternar para {currentMode === 'light' ? 'Modo Escuro (Dark)' : 'Modo Claro (Light)'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
