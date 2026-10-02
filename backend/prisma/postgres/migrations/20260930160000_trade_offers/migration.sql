-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offeredCardId" TEXT NOT NULL,
    "requestedCardId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeOffer_status_createdAt_idx" ON "TradeOffer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeOffer_userId_status_idx" ON "TradeOffer"("userId", "status");

-- CreateIndex
CREATE INDEX "TradeOffer_acceptedById_idx" ON "TradeOffer"("acceptedById");

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_offeredCardId_fkey" FOREIGN KEY ("offeredCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_requestedCardId_fkey" FOREIGN KEY ("requestedCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

