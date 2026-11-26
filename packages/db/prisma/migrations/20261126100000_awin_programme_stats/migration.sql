-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "awinMinEpc" DECIMAL(12,4),
ADD COLUMN     "awinPrioritizeEpc" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AwinProgrammeStats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "displayUrl" TEXT,
    "currency" TEXT,
    "epc" DECIMAL(12,4),
    "conversionRate" DECIMAL(8,4),
    "approvalPercentage" DECIMAL(7,4),
    "averagePaymentTime" INTEGER,
    "validationDays" INTEGER,
    "awinIndex" DECIMAL(10,4),
    "commissionMin" DECIMAL(12,4),
    "commissionMax" DECIMAL(12,4),
    "commissionType" TEXT,
    "score" DECIMAL(14,6),
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwinProgrammeStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AwinProgrammeStats_tenantId_score_idx" ON "AwinProgrammeStats"("tenantId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "AwinProgrammeStats_tenantId_advertiserId_key" ON "AwinProgrammeStats"("tenantId", "advertiserId");

-- AddForeignKey
ALTER TABLE "AwinProgrammeStats" ADD CONSTRAINT "AwinProgrammeStats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

