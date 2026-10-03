-- Poussières d'Étoile : solde du compte (jamais négatif) et historique des mouvements.
ALTER TABLE "User" ADD COLUMN "stardust" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StardustEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StardustEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DlePuzzle" (
    "day" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("day", "mode")
);

-- CreateTable
CREATE TABLE "DleDaily" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "guesses" TEXT NOT NULL DEFAULT '[]',
    "solvedAt" DATETIME,
    "reward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "day", "mode"),
    CONSTRAINT "DleDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DleStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "dailyStreak" INTEGER NOT NULL DEFAULT 0,
    "dailyBest" INTEGER NOT NULL DEFAULT 0,
    "dailyLastDay" TEXT,
    "dailySolved" INTEGER NOT NULL DEFAULT 0,
    "roomsPlayed" INTEGER NOT NULL DEFAULT 0,
    "roomsWon" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DleStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StardustEntry_userId_reason_createdAt_idx" ON "StardustEntry"("userId", "reason", "createdAt");
