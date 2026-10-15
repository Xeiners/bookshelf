-- CreateTable
CREATE TABLE "RunnerItem" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "obtainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "itemId"),
    CONSTRAINT "RunnerItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunnerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RunnerStats" ("best", "bestAt", "bestDistance", "day", "dayEarned", "games", "totalDistance", "updatedAt", "userId") SELECT "best", "bestAt", "bestDistance", "day", "dayEarned", "games", "totalDistance", "updatedAt", "userId" FROM "RunnerStats";
DROP TABLE "RunnerStats";
ALTER TABLE "new_RunnerStats" RENAME TO "RunnerStats";
CREATE INDEX "RunnerStats_best_idx" ON "RunnerStats"("best");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
