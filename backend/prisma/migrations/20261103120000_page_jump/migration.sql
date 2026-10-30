-- CreateTable
CREATE TABLE "JumpStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestHeight" INTEGER NOT NULL DEFAULT 0,
    "bestAt" DATETIME,
    "games" INTEGER NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "stomps" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JumpStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JumpStats_best_idx" ON "JumpStats"("best");

