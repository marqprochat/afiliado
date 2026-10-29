-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateTable
CREATE TABLE "MasterProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cleanTitle" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brand" TEXT,
    "ean" TEXT,
    "category" TEXT,
    "imageUrl" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lowestPriceEver" DECIMAL(12,2) NOT NULL,
    "averagePrice30d" DECIMAL(12,2),
    "currentBestPrice" DECIMAL(12,2) NOT NULL,
    "bestListingId" TEXT,
    "listingsCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductListing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "masterProductId" TEXT NOT NULL,
    "source" "ProductSource" NOT NULL,
    "storeName" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "affiliateUrl" TEXT,
    "currentPrice" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "discountPct" INTEGER,
    "imageUrl" TEXT,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "masterProductId" TEXT NOT NULL,
    "targetPrice" DECIMAL(12,2),
    "notifyOnAnyDrop" BOOLEAN NOT NULL DEFAULT false,
    "channel" "AlertChannel" NOT NULL DEFAULT 'WHATSAPP',
    "recipient" TEXT NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3),
    "lastNotifiedPrice" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MasterProduct_tenantId_slug_key" ON "MasterProduct"("tenantId", "slug");
CREATE INDEX "MasterProduct_tenantId_ean_idx" ON "MasterProduct"("tenantId", "ean");
CREATE INDEX "MasterProduct_tenantId_cleanTitle_idx" ON "MasterProduct"("tenantId", "cleanTitle");
CREATE INDEX "MasterProduct_tenantId_currentBestPrice_idx" ON "MasterProduct"("tenantId", "currentBestPrice");
CREATE INDEX "MasterProduct_tenantId_lowestPriceEver_idx" ON "MasterProduct"("tenantId", "lowestPriceEver");
CREATE INDEX "MasterProduct_tenantId_category_idx" ON "MasterProduct"("tenantId", "category");

CREATE UNIQUE INDEX "ProductListing_tenantId_source_externalId_key" ON "ProductListing"("tenantId", "source", "externalId");
CREATE INDEX "ProductListing_tenantId_masterProductId_idx" ON "ProductListing"("tenantId", "masterProductId");
CREATE INDEX "ProductListing_tenantId_currentPrice_idx" ON "ProductListing"("tenantId", "currentPrice");
CREATE INDEX "ProductListing_tenantId_source_idx" ON "ProductListing"("tenantId", "source");

CREATE INDEX "PriceHistory_listingId_recordedAt_idx" ON "PriceHistory"("listingId", "recordedAt");
CREATE INDEX "PriceAlert_tenantId_masterProductId_triggered_idx" ON "PriceAlert"("tenantId", "masterProductId", "triggered");
CREATE INDEX "PriceAlert_tenantId_recipient_idx" ON "PriceAlert"("tenantId", "recipient");

-- AddForeignKey
ALTER TABLE "MasterProduct" ADD CONSTRAINT "MasterProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
