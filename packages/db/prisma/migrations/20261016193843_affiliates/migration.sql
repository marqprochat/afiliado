-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MarketplaceConnection" ADD COLUMN     "subId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "impersonatorUserId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentTenantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Tenant_parentTenantId_idx" ON "Tenant"("parentTenantId");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_parentTenantId_fkey" FOREIGN KEY ("parentTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "User" SET "isSuperAdmin" = true WHERE lower("email") = 'admin@dudurochatec.com';
