-- CreateEnum
CREATE TYPE "CouponOrigin" AS ENUM ('MANUAL', 'API', 'EXTENSION', 'IMPORT', 'MIRROR');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('UNVERIFIED', 'VALID', 'INVALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENT', 'FIXED', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "CouponCheckMethod" AS ENUM ('MANUAL', 'EXTENSION', 'SOURCE', 'EXPIRY');

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN "scope" TEXT NOT NULL DEFAULT '',
ADD COLUMN "advertiserName" TEXT,
ADD COLUMN "terms" TEXT,
ADD COLUMN "discountType" "CouponDiscountType",
ADD COLUMN "discountValue" DECIMAL(10,2),
ADD COLUMN "minSpend" DECIMAL(10,2),
ADD COLUMN "startsAt" TIMESTAMP(3),
ADD COLUMN "affiliateUrl" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "remainingUses" INTEGER,
ADD COLUMN "origin" "CouponOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "status" "CouponStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "lastSeenAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex
DROP INDEX "Coupon_tenantId_store_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenantId_store_code_scope_key" ON "Coupon"("tenantId", "store", "code", "scope");

-- CreateIndex
CREATE INDEX "Coupon_tenantId_status_expiresAt_idx" ON "Coupon"("tenantId", "status", "expiresAt");

-- CreateTable
CREATE TABLE "CouponCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "result" "CouponStatus" NOT NULL,
    "method" "CouponCheckMethod" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CouponCheck_couponId_createdAt_idx" ON "CouponCheck"("couponId", "createdAt");

-- AddForeignKey
ALTER TABLE "CouponCheck" ADD CONSTRAINT "CouponCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCheck" ADD CONSTRAINT "CouponCheck_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
