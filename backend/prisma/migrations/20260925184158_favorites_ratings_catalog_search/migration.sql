-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CatalogWork" (
    "anilistId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mangadexId" TEXT,
    "country" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "meanScore" INTEGER,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "genres" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "anilist" TEXT NOT NULL,
    "mangadex" TEXT,
    "mdRating" REAL,
    "status" TEXT,
    "chapters" INTEGER,
    "year" INTEGER,
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CatalogWork" ("anilist", "anilistId", "country", "format", "genres", "mangadex", "mangadexId", "mdRating", "meanScore", "popularity", "tags", "updatedAt") SELECT "anilist", "anilistId", "country", "format", "genres", "mangadex", "mangadexId", "mdRating", "meanScore", "popularity", "tags", "updatedAt" FROM "CatalogWork";
DROP TABLE "CatalogWork";
ALTER TABLE "new_CatalogWork" RENAME TO "CatalogWork";
CREATE UNIQUE INDEX "CatalogWork_mangadexId_key" ON "CatalogWork"("mangadexId");
CREATE INDEX "CatalogWork_country_popularity_idx" ON "CatalogWork"("country", "popularity");
CREATE TABLE "new_LibraryEntry" (
    "userId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "userRating" REAL,
    "snapshot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "workId"),
    CONSTRAINT "LibraryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LibraryEntry" ("addedAt", "progress", "snapshot", "status", "title", "updatedAt", "userId", "workId") SELECT "addedAt", "progress", "snapshot", "status", "title", "updatedAt", "userId", "workId" FROM "LibraryEntry";
DROP TABLE "LibraryEntry";
ALTER TABLE "new_LibraryEntry" RENAME TO "LibraryEntry";
CREATE INDEX "LibraryEntry_userId_status_idx" ON "LibraryEntry"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
