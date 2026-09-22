-- AlterEnum
ALTER TYPE "MarketplaceKind" ADD VALUE 'AWIN';

-- CreateTable
CREATE TABLE "AwinCatalogProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "advertiserId" TEXT,
    "advertiserName" TEXT,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "imageUrl" TEXT,
    "deepLink" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "lastImportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwinCatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AwinCatalogProduct_tenantId_title_idx" ON "AwinCatalogProduct"("tenantId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "AwinCatalogProduct_tenantId_feedId_externalId_key" ON "AwinCatalogProduct"("tenantId", "feedId", "externalId");

-- AddForeignKey
ALTER TABLE "AwinCatalogProduct" ADD CONSTRAINT "AwinCatalogProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
