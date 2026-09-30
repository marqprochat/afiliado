-- CreateEnum
CREATE TYPE "GroupTextPosition" AS ENUM ('PREFIX', 'SUFFIX');

-- CreateEnum
CREATE TYPE "GroupLinkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "ManagedGroupStatus" AS ENUM ('CREATING', 'STANDBY', 'ACTIVE', 'FULL', 'ORPHANED');

-- CreateTable
CREATE TABLE "GroupLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseName" TEXT NOT NULL,
    "customText" TEXT NOT NULL DEFAULT '',
    "textPosition" "GroupTextPosition" NOT NULL DEFAULT 'PREFIX',
    "numberPrefix" TEXT NOT NULL DEFAULT '#',
    "startNumber" INTEGER NOT NULL DEFAULT 1,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "memberLimit" INTEGER NOT NULL DEFAULT 1000,
    "rotateMargin" INTEGER NOT NULL DEFAULT 20,
    "maxRotationsPerHour" INTEGER NOT NULL DEFAULT 3,
    "groupDescription" TEXT,
    "announceOnly" BOOLEAN NOT NULL DEFAULT false,
    "seedParticipants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fallbackUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "GroupLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastRotatedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupLinkId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "jid" TEXT,
    "name" TEXT NOT NULL,
    "inviteLink" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ManagedGroupStatus" NOT NULL DEFAULT 'CREATING',
    "countSyncedAt" TIMESTAMP(3),
    "inviteSyncedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupLink_slug_key" ON "GroupLink"("slug");

-- CreateIndex
CREATE INDEX "GroupLink_tenantId_idx" ON "GroupLink"("tenantId");

-- CreateIndex
CREATE INDEX "GroupLink_sessionId_idx" ON "GroupLink"("sessionId");

-- CreateIndex
CREATE INDEX "ManagedGroup_tenantId_idx" ON "ManagedGroup"("tenantId");

-- CreateIndex
CREATE INDEX "ManagedGroup_jid_idx" ON "ManagedGroup"("jid");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedGroup_groupLinkId_sequence_key" ON "ManagedGroup"("groupLinkId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedGroup_groupLinkId_jid_key" ON "ManagedGroup"("groupLinkId", "jid");

-- Partial Unique Index: only one ACTIVE ManagedGroup per GroupLink
CREATE UNIQUE INDEX "ManagedGroup_groupLinkId_active_unique" ON "ManagedGroup"("groupLinkId") WHERE status = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "GroupLink" ADD CONSTRAINT "GroupLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupLink" ADD CONSTRAINT "GroupLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedGroup" ADD CONSTRAINT "ManagedGroup_groupLinkId_fkey" FOREIGN KEY ("groupLinkId") REFERENCES "GroupLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
