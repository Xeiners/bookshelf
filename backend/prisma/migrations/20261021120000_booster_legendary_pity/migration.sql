-- Garantie : une Légendaire (ou mieux) au plus tard au 120e booster.
ALTER TABLE "UserBooster" ADD COLUMN "boostersSinceLastLegendary" INTEGER NOT NULL DEFAULT 0;
