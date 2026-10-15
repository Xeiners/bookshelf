-- AlterTable
ALTER TABLE "RunnerStats" ADD COLUMN     "boxPity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "boxes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freeBoxAt" TIMESTAMP(3),
ADD COLUMN     "outfit" TEXT NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "RunnerItem" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerItem_pkey" PRIMARY KEY ("userId","itemId")
);

-- AddForeignKey
ALTER TABLE "RunnerItem" ADD CONSTRAINT "RunnerItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
