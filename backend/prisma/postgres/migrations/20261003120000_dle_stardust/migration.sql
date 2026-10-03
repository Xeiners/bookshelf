-- Poussières d'Étoile : solde du compte (jamais négatif) et historique des mouvements.
ALTER TABLE "User" ADD COLUMN "stardust" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StardustEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StardustEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DlePuzzle" (
    "day" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DlePuzzle_pkey" PRIMARY KEY ("day","mode")
);

-- CreateTable
CREATE TABLE "DleDaily" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "guesses" TEXT NOT NULL DEFAULT '[]',
    "solvedAt" TIMESTAMP(3),
    "reward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DleDaily_pkey" PRIMARY KEY ("userId","day","mode")
);

-- CreateTable
CREATE TABLE "DleStats" (
    "userId" TEXT NOT NULL,
    "dailyStreak" INTEGER NOT NULL DEFAULT 0,
    "dailyBest" INTEGER NOT NULL DEFAULT 0,
    "dailyLastDay" TEXT,
    "dailySolved" INTEGER NOT NULL DEFAULT 0,
    "roomsPlayed" INTEGER NOT NULL DEFAULT 0,
    "roomsWon" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DleStats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "StardustEntry_userId_reason_createdAt_idx" ON "StardustEntry"("userId", "reason", "createdAt");

-- AddForeignKey
ALTER TABLE "StardustEntry" ADD CONSTRAINT "StardustEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DleDaily" ADD CONSTRAINT "DleDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DleStats" ADD CONSTRAINT "DleStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
