/*
  Warnings:

  - Added the required column `sessionId` to the `MirrorRule` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MirrorLogStatus" AS ENUM ('MIRRORED', 'DISCARDED', 'ERROR');

-- AlterTable
ALTER TABLE "MirrorRule" ADD COLUMN     "dedupHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Espelhamento',
ADD COLUMN     "sessionId" TEXT NOT NULL,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "MirrorLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceJid" TEXT NOT NULL,
    "sourceMsgId" TEXT NOT NULL,
    "targetJid" TEXT NOT NULL,
    "status" "MirrorLogStatus" NOT NULL,
    "reason" TEXT,
    "productKey" TEXT,
    "waMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MirrorLog_tenantId_targetJid_productKey_createdAt_idx" ON "MirrorLog"("tenantId", "targetJid", "productKey", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorLog_ruleId_createdAt_idx" ON "MirrorLog"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorLog_tenantId_createdAt_idx" ON "MirrorLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorRule_tenantId_enabled_idx" ON "MirrorRule"("tenantId", "enabled");

-- AddForeignKey
ALTER TABLE "MirrorRule" ADD CONSTRAINT "MirrorRule_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorRule" ADD CONSTRAINT "MirrorRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorLog" ADD CONSTRAINT "MirrorLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorLog" ADD CONSTRAINT "MirrorLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MirrorRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
