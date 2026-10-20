-- CreateTable
CREATE TABLE "GuestReceiptClaim" (
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestReceiptClaim_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "GuestReceiptClaim_claimedAt_idx" ON "GuestReceiptClaim"("claimedAt");
