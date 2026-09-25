-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "scores" TEXT NOT NULL DEFAULT '{"genres":{},"tags":{}}',
    "swipes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogWork" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogWork_mangadexId_key" ON "CatalogWork"("mangadexId");

-- CreateIndex
CREATE INDEX "CatalogWork_country_popularity_idx" ON "CatalogWork"("country", "popularity");
