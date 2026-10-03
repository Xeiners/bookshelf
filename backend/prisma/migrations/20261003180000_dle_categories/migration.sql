-- BookshelfDLE : catégories (mangas, Naruto). Les énigmes et parties existantes restent dans « manga ».
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DleDaily" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'manga',
    "mode" TEXT NOT NULL,
    "guesses" TEXT NOT NULL DEFAULT '[]',
    "solvedAt" DATETIME,
    "reward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "day", "category", "mode"),
    CONSTRAINT "DleDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DleDaily" ("createdAt", "day", "guesses", "mode", "reward", "solvedAt", "updatedAt", "userId") SELECT "createdAt", "day", "guesses", "mode", "reward", "solvedAt", "updatedAt", "userId" FROM "DleDaily";
DROP TABLE "DleDaily";
ALTER TABLE "new_DleDaily" RENAME TO "DleDaily";
CREATE TABLE "new_DlePuzzle" (
    "day" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'manga',
    "mode" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("day", "category", "mode")
);
INSERT INTO "new_DlePuzzle" ("cardId", "createdAt", "day", "mode") SELECT "cardId", "createdAt", "day", "mode" FROM "DlePuzzle";
DROP TABLE "DlePuzzle";
ALTER TABLE "new_DlePuzzle" RENAME TO "DlePuzzle";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

