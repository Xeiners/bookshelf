-- CreateTable
CREATE TABLE "GuestReceiptClaim" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "GuestReceiptClaim_claimedAt_idx" ON "GuestReceiptClaim"("claimedAt");
