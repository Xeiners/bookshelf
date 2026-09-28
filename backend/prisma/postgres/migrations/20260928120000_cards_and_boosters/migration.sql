-- CreateTable
CREATE TABLE "UserBooster" (
    "userId" TEXT NOT NULL,
    "availableBoosters" INTEGER NOT NULL DEFAULT 2,
    "lastClaimedAt" TIMESTAMP(3),
    "nextBoosterAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBooster_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "characterName" TEXT,
    "imageUrl" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "mangaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCard" (
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserCard_pkey" PRIMARY KEY ("userId","cardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_number_key" ON "Card"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Card_mangaId_key" ON "Card"("mangaId");

-- CreateIndex
CREATE INDEX "Card_rarity_idx" ON "Card"("rarity");

-- AddForeignKey
ALTER TABLE "UserBooster" ADD CONSTRAINT "UserBooster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

