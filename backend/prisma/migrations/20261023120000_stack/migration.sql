-- CreateTable
CREATE TABLE "StackStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestPages" INTEGER NOT NULL DEFAULT 0,
    "bestAt" DATETIME,
    "games" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "perfects" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StackStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StackStats_best_idx" ON "StackStats"("best");
