-- CreateTable
CREATE TABLE "TeamEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "boosters" INTEGER NOT NULL DEFAULT 0,
    "legendaryPacks" INTEGER NOT NULL DEFAULT 0,
    "stardust" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamEventClaim" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEventClaim_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "TeamEvent_endsAt_idx" ON "TeamEvent"("endsAt");

-- CreateIndex
CREATE INDEX "TeamEventClaim_userId_idx" ON "TeamEventClaim"("userId");

-- AddForeignKey
ALTER TABLE "TeamEventClaim" ADD CONSTRAINT "TeamEventClaim_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEventClaim" ADD CONSTRAINT "TeamEventClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

