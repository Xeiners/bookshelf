-- CreateTable
CREATE TABLE "UserBooster" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "availableBoosters" INTEGER NOT NULL DEFAULT 2,
    "lastClaimedAt" DATETIME,
    "nextBoosterAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserBooster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "characterName" TEXT,
    "imageUrl" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "mangaId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserCard" (
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "obtainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY ("userId", "cardId"),
    CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_number_key" ON "Card"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Card_mangaId_key" ON "Card"("mangaId");

-- CreateIndex
CREATE INDEX "Card_rarity_idx" ON "Card"("rarity");

