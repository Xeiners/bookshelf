-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RunnerStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestDistance" INTEGER NOT NULL DEFAULT 0,
    "bestAt" DATETIME,
    "games" INTEGER NOT NULL DEFAULT 0,
    "totalDistance" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "outfit" TEXT NOT NULL DEFAULT '{}',
    "freeBoxAt" DATETIME,
    "boxes" INTEGER NOT NULL DEFAULT 0,
    "boxPity" INTEGER NOT NULL DEFAULT 0,
    "giftBoxes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunnerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RunnerStats" ("best", "bestAt", "bestDistance", "boxPity", "boxes", "day", "dayEarned", "freeBoxAt", "games", "outfit", "totalDistance", "updatedAt", "userId") SELECT "best", "bestAt", "bestDistance", "boxPity", "boxes", "day", "dayEarned", "freeBoxAt", "games", "outfit", "totalDistance", "updatedAt", "userId" FROM "RunnerStats";
DROP TABLE "RunnerStats";
ALTER TABLE "new_RunnerStats" RENAME TO "RunnerStats";
CREATE INDEX "RunnerStats_best_idx" ON "RunnerStats"("best");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
