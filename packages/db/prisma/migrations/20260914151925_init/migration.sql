-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WaSessionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'NEEDS_QR', 'CONNECTED', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "WaGroupKind" AS ENUM ('GROUP', 'COMMUNITY', 'CHANNEL');

-- CreateEnum
CREATE TYPE "MarketplaceKind" AS ENUM ('SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('UNCONFIGURED', 'OK', 'ERROR');

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU', 'MANUAL');

-- CreateEnum
CREATE TYPE "Shipping" AS ENUM ('NONE', 'FREE', 'FULL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "QueueItemStatus" AS ENUM ('PENDING', 'SENT', 'ERROR');

-- CreateEnum
CREATE TYPE "MediaMode" AS ENUM ('IMAGE', 'PREVIEW');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'ERROR');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('SENT', 'ERROR');

-- CreateEnum
CREATE TYPE "MirrorMode" AS ENUM ('TEMPLATE', 'CLONE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "features" JSONB NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT,
    "status" "WaSessionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "authCreds" JSONB,
    "lastQr" TEXT,
    "pairCode" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaAuthKey" (
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "WaAuthKey_pkey" PRIMARY KEY ("sessionId","type","keyId")
);

-- CreateTable
CREATE TABLE "WaGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WaGroupKind" NOT NULL DEFAULT 'GROUP',
    "botIsAdmin" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "inviteLink" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "MarketplaceKind" NOT NULL,
    "encryptedCredentials" BYTEA,
    "affiliateTag" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "ProductSource" NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "discountPct" INTEGER,
    "salesCount" INTEGER,
    "commissionPct" DECIMAL(5,2),
    "images" TEXT[],
    "shipping" "Shipping" NOT NULL DEFAULT 'UNKNOWN',
    "flashSaleEndsAt" TIMESTAMP(3),
    "couponCode" TEXT,
    "couponValue" DECIMAL(12,2),
    "originalUrl" TEXT NOT NULL,
    "shopId" TEXT,
    "shopName" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "status" "QueueItemStatus" NOT NULL DEFAULT 'PENDING',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingWindow" (
    "tenantId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '07:30',
    "endTime" TEXT NOT NULL DEFAULT '23:30',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OperatingWindow_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Setting" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupJids" TEXT[],
    "intervalMin" INTEGER NOT NULL,
    "mediaMode" "MediaMode" NOT NULL DEFAULT 'IMAGE',
    "shuffled" BOOLEAN NOT NULL DEFAULT false,
    "status" "BatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "estimatedEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,

    CONSTRAINT "BatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchItemId" TEXT,
    "groupJid" TEXT NOT NULL,
    "waMessageId" TEXT,
    "status" "SendStatus" NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MirrorRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceJids" TEXT[],
    "targetJids" TEXT[],
    "mode" "MirrorMode" NOT NULL DEFAULT 'CLONE',
    "mediaMode" "MediaMode" NOT NULL DEFAULT 'PREVIEW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "store" "MarketplaceKind" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "times" TEXT[],
    "groupJids" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WaGroup_tenantId_idx" ON "WaGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WaGroup_sessionId_jid_key" ON "WaGroup"("sessionId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_tenantId_kind_key" ON "MarketplaceConnection"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_source_externalId_key" ON "Product"("tenantId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_tenantId_productId_key" ON "QueueItem"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "Template_tenantId_idx" ON "Template"("tenantId");

-- CreateIndex
CREATE INDEX "Batch_tenantId_status_idx" ON "Batch"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BatchItem_batchId_productId_key" ON "BatchItem"("batchId", "productId");

-- CreateIndex
CREATE INDEX "SendLog_tenantId_sentAt_idx" ON "SendLog"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "SendLog_batchItemId_groupJid_key" ON "SendLog"("batchItemId", "groupJid");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenantId_store_code_key" ON "Coupon"("tenantId", "store", "code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaSession" ADD CONSTRAINT "WaSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaAuthKey" ADD CONSTRAINT "WaAuthKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaGroup" ADD CONSTRAINT "WaGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaGroup" ADD CONSTRAINT "WaGroup_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceConnection" ADD CONSTRAINT "MarketplaceConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingWindow" ADD CONSTRAINT "OperatingWindow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchItem" ADD CONSTRAINT "BatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchItem" ADD CONSTRAINT "BatchItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "BatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorRule" ADD CONSTRAINT "MirrorRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
