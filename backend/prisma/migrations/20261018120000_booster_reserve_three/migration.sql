-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserBooster" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "availableBoosters" INTEGER NOT NULL DEFAULT 3,
    "giftedBoosters" INTEGER NOT NULL DEFAULT 0,
    "boostersSinceLastMythic" INTEGER NOT NULL DEFAULT 0,
    "lastClaimedAt" DATETIME,
    "nextBoosterAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserBooster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserBooster" ("availableBoosters", "boostersSinceLastMythic", "giftedBoosters", "lastClaimedAt", "nextBoosterAt", "updatedAt", "userId") SELECT "availableBoosters", "boostersSinceLastMythic", "giftedBoosters", "lastClaimedAt", "nextBoosterAt", "updatedAt", "userId" FROM "UserBooster";
DROP TABLE "UserBooster";
ALTER TABLE "new_UserBooster" RENAME TO "UserBooster";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Réserve de boosters portée à 3 : les réserves pleines (2, sans compte à rebours) reçoivent leur troisième.
UPDATE "UserBooster" SET "availableBoosters" = 3 WHERE "availableBoosters" = 2 AND "nextBoosterAt" IS NULL;
