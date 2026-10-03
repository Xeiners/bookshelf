-- Higher or Lower : meilleures séries d'un compte (du jour et de tous les temps).
CREATE TABLE "HigherLowerStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestMetric" TEXT,
    "bestAt" DATETIME,
    "day" TEXT,
    "dayBest" INTEGER NOT NULL DEFAULT 0,
    "dayMetric" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "games" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HigherLowerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HigherLowerStats_best_idx" ON "HigherLowerStats"("best");

-- CreateIndex
CREATE INDEX "HigherLowerStats_day_dayBest_idx" ON "HigherLowerStats"("day", "dayBest");
