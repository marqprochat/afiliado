-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "telegramChatIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
