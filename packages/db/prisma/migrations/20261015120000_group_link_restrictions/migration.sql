-- AlterTable
ALTER TABLE "GroupLink" ADD COLUMN "restrictEditInfo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "restrictAddMembers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "joinApproval" BOOLEAN NOT NULL DEFAULT false;
