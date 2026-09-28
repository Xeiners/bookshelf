-- Profil : présentation, avatar et vitrine de cartes, titre affiché, compteur de boosters.
ALTER TABLE "User" ADD COLUMN "bio" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarCardId" TEXT;
ALTER TABLE "User" ADD COLUMN "featuredCardIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN "activeTitle" TEXT;
ALTER TABLE "User" ADD COLUMN "boostersOpened" INTEGER NOT NULL DEFAULT 0;

-- Comptes existants : aucun historique d'ouverture. Estimation par les cartes
-- obtenues (5 par booster), boosters d'essai compris.
UPDATE "User"
SET "boostersOpened" = (
  SELECT COALESCE(SUM("count"), 0) FROM "UserCard" WHERE "UserCard"."userId" = "User"."id"
) / 5;
