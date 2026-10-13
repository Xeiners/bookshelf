-- CreateTable
CREATE TABLE "RunnerStats" (
    "userId" TEXT NOT NULL,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestDistance" INTEGER NOT NULL DEFAULT 0,
    "bestAt" TIMESTAMP(3),
    "games" INTEGER NOT NULL DEFAULT 0,
    "totalDistance" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunnerStats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "RunnerStats_best_idx" ON "RunnerStats"("best");

-- AddForeignKey
ALTER TABLE "RunnerStats" ADD CONSTRAINT "RunnerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
