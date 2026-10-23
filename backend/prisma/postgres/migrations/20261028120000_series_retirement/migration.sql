-- CreateTable
CREATE TABLE "SeriesRetirement" (
    "userId" TEXT NOT NULL,
    "stardust" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL,
    "cards" INTEGER NOT NULL,
    "byRarity" TEXT NOT NULL DEFAULT '{}',
    "highlights" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "SeriesRetirement_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "SeriesRetirement" ADD CONSTRAINT "SeriesRetirement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

