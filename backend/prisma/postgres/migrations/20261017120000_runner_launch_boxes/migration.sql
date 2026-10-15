-- AlterTable
ALTER TABLE "RunnerStats" ALTER COLUMN "giftBoxes" SET DEFAULT 2;

-- Ouverture du Runner à tous : deux boîtes offertes aux joueurs déjà inscrits.
UPDATE "RunnerStats" SET "giftBoxes" = "giftBoxes" + 2;
