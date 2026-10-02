-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "offeredCardId" TEXT NOT NULL,
    "requestedCardId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "acceptedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeOffer_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TradeOffer_offeredCardId_fkey" FOREIGN KEY ("offeredCardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeOffer_requestedCardId_fkey" FOREIGN KEY ("requestedCardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TradeOffer_status_createdAt_idx" ON "TradeOffer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeOffer_userId_status_idx" ON "TradeOffer"("userId", "status");

-- CreateIndex
CREATE INDEX "TradeOffer_acceptedById_idx" ON "TradeOffer"("acceptedById");

