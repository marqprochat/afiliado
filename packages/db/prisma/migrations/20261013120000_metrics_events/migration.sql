-- CreateEnum
CREATE TYPE "GroupMemberAction" AS ENUM ('JOIN', 'LEAVE', 'REMOVED', 'ADDED', 'PROMOTED', 'DEMOTED');

-- CreateTable
CREATE TABLE "GroupMemberEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "participantJid" TEXT NOT NULL,
    "action" "GroupMemberAction" NOT NULL,
    "actorJid" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMemberEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkClickEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupLinkId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetGroupJid" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberEvent_dedupeKey_key" ON "GroupMemberEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "GroupMemberEvent_tenantId_occurredAt_idx" ON "GroupMemberEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "GroupMemberEvent_tenantId_groupJid_occurredAt_idx" ON "GroupMemberEvent"("tenantId", "groupJid", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSnapshot_sessionId_groupJid_date_key" ON "GroupSnapshot"("sessionId", "groupJid", "date");

-- CreateIndex
CREATE INDEX "GroupSnapshot_tenantId_date_idx" ON "GroupSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "GroupSnapshot_tenantId_groupJid_date_idx" ON "GroupSnapshot"("tenantId", "groupJid", "date");

-- CreateIndex
CREATE INDEX "LinkClickEvent_tenantId_clickedAt_idx" ON "LinkClickEvent"("tenantId", "clickedAt");

-- CreateIndex
CREATE INDEX "LinkClickEvent_groupLinkId_clickedAt_idx" ON "LinkClickEvent"("groupLinkId", "clickedAt");

-- AddForeignKey
ALTER TABLE "GroupMemberEvent" ADD CONSTRAINT "GroupMemberEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSnapshot" ADD CONSTRAINT "GroupSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClickEvent" ADD CONSTRAINT "LinkClickEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClickEvent" ADD CONSTRAINT "LinkClickEvent_groupLinkId_fkey" FOREIGN KEY ("groupLinkId") REFERENCES "GroupLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
