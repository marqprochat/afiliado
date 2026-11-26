-- CreateEnum
CREATE TYPE "AffiliateNetwork" AS ENUM ('AWIN');

-- CreateEnum
CREATE TYPE "AffiliateSaleStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'DELETED');

-- CreateEnum
CREATE TYPE "SaleChannelKind" AS ENUM ('WHATSAPP', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "AffiliateSaleSource" AS ENUM ('API', 'WEBHOOK');

-- AlterTable
ALTER TABLE "WaGroup" ADD COLUMN     "trackCode" TEXT;

-- AlterTable
ALTER TABLE "TelegramChat" ADD COLUMN     "trackCode" TEXT;

-- CreateTable
CREATE TABLE "OfferClick" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channelCode" TEXT,
    "batchId" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "network" "AffiliateNetwork" NOT NULL DEFAULT 'AWIN',
    "externalId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "advertiserName" TEXT,
    "saleAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "AffiliateSaleStatus" NOT NULL DEFAULT 'PENDING',
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "validationDate" TIMESTAMP(3),
    "clickRef" TEXT,
    "clickRef2" TEXT,
    "clickRef3" TEXT,
    "clickRef4" TEXT,
    "clickRef5" TEXT,
    "clickRef6" TEXT,
    "channelKind" "SaleChannelKind",
    "channelId" TEXT,
    "channelName" TEXT,
    "batchId" TEXT,
    "source" "AffiliateSaleSource" NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferClick_tenantId_clickedAt_idx" ON "OfferClick"("tenantId", "clickedAt");

-- CreateIndex
CREATE INDEX "OfferClick_tenantId_channelCode_idx" ON "OfferClick"("tenantId", "channelCode");

-- CreateIndex
CREATE INDEX "AffiliateSale_tenantId_transactionDate_idx" ON "AffiliateSale"("tenantId", "transactionDate");

-- CreateIndex
CREATE INDEX "AffiliateSale_tenantId_channelId_idx" ON "AffiliateSale"("tenantId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateSale_tenantId_network_externalId_key" ON "AffiliateSale"("tenantId", "network", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WaGroup_tenantId_trackCode_key" ON "WaGroup"("tenantId", "trackCode");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChat_tenantId_trackCode_key" ON "TelegramChat"("tenantId", "trackCode");

-- AddForeignKey
ALTER TABLE "OfferClick" ADD CONSTRAINT "OfferClick_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateSale" ADD CONSTRAINT "AffiliateSale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

