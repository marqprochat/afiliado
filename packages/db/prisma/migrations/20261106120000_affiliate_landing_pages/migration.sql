-- CreateTable
CREATE TABLE "AffiliateLandingPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "authorName" TEXT NOT NULL,
    "authorBadge" TEXT DEFAULT 'RADAR VIP · 24H',
    "authorBio" TEXT,
    "authorImage" TEXT,
    "logoText" TEXT,
    "themeColor" TEXT NOT NULL DEFAULT 'red',
    "headline" TEXT,
    "subheadline" TEXT,
    "ctaButtonText" TEXT DEFAULT 'QUERO ENTRAR NOS GRUPOS VIP',
    "stat1Value" TEXT DEFAULT '+10K',
    "stat1Label" TEXT DEFAULT 'Membros VIP',
    "stat2Value" TEXT DEFAULT 'R$ 500K+',
    "stat2Label" TEXT DEFAULT 'Economia Gerada',
    "stat3Value" TEXT DEFAULT '100%',
    "stat3Label" TEXT DEFAULT 'Links Verificados',
    "stat4Value" TEXT DEFAULT '24/7',
    "stat4Label" TEXT DEFAULT 'Radar Ativo',
    "youtubeUrl" TEXT,
    "instagramUrl" TEXT,
    "telegramUrl" TEXT,
    "showBenefits" BOOLEAN NOT NULL DEFAULT true,
    "showAuthority" BOOLEAN NOT NULL DEFAULT true,
    "showCategories" BOOLEAN NOT NULL DEFAULT true,
    "showFaq" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLandingPage_tenantId_key" ON "AffiliateLandingPage"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLandingPage_slug_key" ON "AffiliateLandingPage"("slug");

-- CreateIndex
CREATE INDEX "AffiliateLandingPage_slug_idx" ON "AffiliateLandingPage"("slug");

-- AddForeignKey
ALTER TABLE "AffiliateLandingPage" ADD CONSTRAINT "AffiliateLandingPage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
