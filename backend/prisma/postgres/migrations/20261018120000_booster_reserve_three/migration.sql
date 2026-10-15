-- AlterTable
ALTER TABLE "UserBooster" ALTER COLUMN "availableBoosters" SET DEFAULT 3;

-- Réserve de boosters portée à 3 : les réserves pleines (2, sans compte à rebours) reçoivent leur troisième.
UPDATE "UserBooster" SET "availableBoosters" = 3 WHERE "availableBoosters" = 2 AND "nextBoosterAt" IS NULL;
