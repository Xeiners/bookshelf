-- Administration : suspension, version des sessions, dernière activité.
ALTER TABLE "User" ADD COLUMN "suspendedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;

-- Boosters offerts : hors plafond.
ALTER TABLE "UserBooster" ADD COLUMN "giftedBoosters" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_targetUserId_createdAt_idx" ON "AdminAction"("targetUserId", "createdAt");
