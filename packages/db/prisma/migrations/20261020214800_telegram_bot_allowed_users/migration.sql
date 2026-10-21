-- AlterTable
ALTER TABLE "TelegramBot" ADD COLUMN     "allowedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
