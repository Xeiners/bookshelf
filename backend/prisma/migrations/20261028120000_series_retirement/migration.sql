-- CreateTable
CREATE TABLE "SeriesRetirement" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "stardust" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL,
    "cards" INTEGER NOT NULL,
    "byRarity" TEXT NOT NULL DEFAULT '{}',
    "highlights" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "seenAt" DATETIME,
    CONSTRAINT "SeriesRetirement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

