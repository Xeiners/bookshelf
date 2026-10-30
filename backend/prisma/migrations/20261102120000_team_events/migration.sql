-- CreateTable
CREATE TABLE "TeamEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "boosters" INTEGER NOT NULL DEFAULT 0,
    "legendaryPacks" INTEGER NOT NULL DEFAULT 0,
    "stardust" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TeamEventClaim" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("eventId", "userId"),
    CONSTRAINT "TeamEventClaim_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TeamEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamEventClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamEvent_endsAt_idx" ON "TeamEvent"("endsAt");

-- CreateIndex
CREATE INDEX "TeamEventClaim_userId_idx" ON "TeamEventClaim"("userId");

