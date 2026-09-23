-- AlterTable: adiciona a coluna ainda opcional para poder popular na ordem certa antes de travar NOT NULL
ALTER TABLE "AutomationQueueItem" ADD COLUMN "position" INTEGER;

-- Backfill: preserva a ordem de disparo atual (manual primeiro, depois por addedAt) por regra
UPDATE "AutomationQueueItem" AS t
SET "position" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "ruleId"
    ORDER BY manual DESC, "addedAt" ASC
  ) - 1 AS rn
  FROM "AutomationQueueItem"
) AS sub
WHERE t.id = sub.id;

-- Agora que toda linha tem posição, trava NOT NULL
ALTER TABLE "AutomationQueueItem" ALTER COLUMN "position" SET NOT NULL;

-- Cria a sequência que vai gerar a posição de cada INSERT novo (equivalente a @default(autoincrement())),
-- começando depois do maior valor já usado no backfill para não colidir com os itens existentes
CREATE SEQUENCE "AutomationQueueItem_position_seq" OWNED BY "AutomationQueueItem"."position";
SELECT setval(
  '"AutomationQueueItem_position_seq"',
  COALESCE((SELECT MAX(position) FROM "AutomationQueueItem"), 0) + 1,
  false
);
ALTER TABLE "AutomationQueueItem" ALTER COLUMN "position" SET DEFAULT nextval('"AutomationQueueItem_position_seq"');

-- DropIndex: a ordenação por addedAt não é mais usada nesta tabela
DROP INDEX "AutomationQueueItem_tenantId_ruleId_status_addedAt_idx";

-- CreateIndex
CREATE INDEX "AutomationQueueItem_tenantId_ruleId_status_position_idx" ON "AutomationQueueItem"("tenantId", "ruleId", "status", "position");
