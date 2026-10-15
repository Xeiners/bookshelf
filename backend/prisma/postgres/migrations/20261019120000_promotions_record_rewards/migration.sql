-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "regular" INTEGER NOT NULL,
    "message" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "previous" INTEGER NOT NULL,
    "choice" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_target_endsAt_idx" ON "Promotion"("target", "endsAt");

-- CreateIndex
CREATE INDEX "RecordReward_userId_claimedAt_idx" ON "RecordReward"("userId", "claimedAt");

-- AddForeignKey
ALTER TABLE "RecordReward" ADD CONSTRAINT "RecordReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
