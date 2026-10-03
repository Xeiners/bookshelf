-- Higher or Lower : meilleures séries d'un compte (du jour et de tous les temps).
CREATE TABLE "HigherLowerStats" (
    "userId" TEXT NOT NULL,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestMetric" TEXT,
    "bestAt" TIMESTAMP(3),
    "day" TEXT,
    "dayBest" INTEGER NOT NULL DEFAULT 0,
    "dayMetric" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "games" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HigherLowerStats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "HigherLowerStats_best_idx" ON "HigherLowerStats"("best");

-- CreateIndex
CREATE INDEX "HigherLowerStats_day_dayBest_idx" ON "HigherLowerStats"("day", "dayBest");

-- AddForeignKey
ALTER TABLE "HigherLowerStats" ADD CONSTRAINT "HigherLowerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
