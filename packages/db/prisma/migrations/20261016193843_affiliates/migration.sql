-- AlterTable
-- Não é parte da feature de afiliados: é o drift pré-existente do Prisma. `Coupon.updatedAt` é
-- `@updatedAt` (valor gerado pelo client), mas a migração 20260925120000_coupon_system adicionou a
-- coluna com DEFAULT CURRENT_TIMESTAMP (para preencher linhas antigas); o `migrate dev` detecta a
-- diferença e a remove aqui, junto com as demais mudanças.
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
