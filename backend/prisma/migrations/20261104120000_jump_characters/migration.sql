-- CreateTable
CREATE TABLE "JumpCharacter" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "characterId"),
    CONSTRAINT "JumpCharacter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JumpStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestHeight" INTEGER NOT NULL DEFAULT 0,
    "bestAt" DATETIME,
    "games" INTEGER NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "stomps" INTEGER NOT NULL DEFAULT 0,
    "character" TEXT NOT NULL DEFAULT 'moon',
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JumpStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JumpStats" ("best", "bestAt", "bestHeight", "day", "dayEarned", "games", "stars", "stomps", "updatedAt", "userId") SELECT "best", "bestAt", "bestHeight", "day", "dayEarned", "games", "stars", "stomps", "updatedAt", "userId" FROM "JumpStats";
DROP TABLE "JumpStats";
ALTER TABLE "new_JumpStats" RENAME TO "JumpStats";
CREATE INDEX "JumpStats_best_idx" ON "JumpStats"("best");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

