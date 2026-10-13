-- CreateTable
CREATE TABLE "RunnerStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestDistance" INTEGER NOT NULL DEFAULT 0,
    "bestAt" DATETIME,
    "games" INTEGER NOT NULL DEFAULT 0,
    "totalDistance" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunnerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RunnerStats_best_idx" ON "RunnerStats"("best");
