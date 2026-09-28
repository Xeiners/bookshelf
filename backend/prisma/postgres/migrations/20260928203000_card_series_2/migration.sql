ALTER TABLE "Card" ADD COLUMN "series" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Card" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Card" ADD COLUMN "mangaTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Card" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Card" ADD COLUMN "power" INTEGER NOT NULL DEFAULT 0;

UPDATE "Card"
SET "name" = "title",
    "mangaTitle" = "title",
    "description" = 'Carte fondatrice de la Série 1.',
    "power" = CASE "rarity"
      WHEN 'MYTHIC' THEN 100
      WHEN 'LEGENDARY' THEN 80
      WHEN 'EPIC' THEN 60
      WHEN 'RARE' THEN 40
      ELSE 20
    END;

CREATE INDEX "Card_series_rarity_idx" ON "Card"("series", "rarity");
