-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('PRODUCT', 'COUPON');

-- CreateEnum
CREATE TYPE "AutomationLogAction" AS ENUM ('DISCOVERED', 'DISPATCHED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "AutomationItemKind" AS ENUM ('PRODUCT', 'COUPON');

-- CreateEnum
CREATE TYPE "AutomationQueueStatus" AS ENUM ('PENDING', 'DISPATCHED', 'REMOVED');

-- DropForeignKey
ALTER TABLE "BatchItem" DROP CONSTRAINT "BatchItem_productId_fkey";

-- AlterTable
ALTER TABLE "BatchItem" ADD COLUMN     "couponId" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "kind" "TemplateKind" NOT NULL DEFAULT 'PRODUCT';

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "marketplaces" "MarketplaceKind"[],
    "keywords" TEXT[],
    "blockedKeywords" TEXT[],
    "minDiscountPct" INTEGER,
    "minPrice" DECIMAL(12,2),
    "maxPrice" DECIMAL(12,2),
    "maxOffersPerDay" INTEGER NOT NULL DEFAULT 20,
    "intervalMin" INTEGER NOT NULL DEFAULT 60,
    "sessionId" TEXT NOT NULL,
    "groupJids" TEXT[],
    "templateId" TEXT NOT NULL,
    "mediaMode" "MediaMode" NOT NULL DEFAULT 'IMAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "marketplace" "MarketplaceKind" NOT NULL,
    "action" "AutomationLogAction" NOT NULL,
    "productId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationQueueItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "kind" "AutomationItemKind" NOT NULL,
    "productId" TEXT,
    "couponId" TEXT,
    "templateId" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "status" "AutomationQueueStatus" NOT NULL DEFAULT 'PENDING',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_enabled_idx" ON "AutomationRule"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationLog_tenantId_ruleId_createdAt_idx" ON "AutomationLog"("tenantId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationQueueItem_tenantId_ruleId_status_addedAt_idx" ON "AutomationQueueItem"("tenantId", "ruleId", "status", "addedAt");

-- AddForeignKey
ALTER TABLE "BatchItem" ADD CONSTRAINT "BatchItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchItem" ADD CONSTRAINT "BatchItem_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationQueueItem" ADD CONSTRAINT "AutomationQueueItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationQueueItem" ADD CONSTRAINT "AutomationQueueItem_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationQueueItem" ADD CONSTRAINT "AutomationQueueItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationQueueItem" ADD CONSTRAINT "AutomationQueueItem_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationQueueItem" ADD CONSTRAINT "AutomationQueueItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
