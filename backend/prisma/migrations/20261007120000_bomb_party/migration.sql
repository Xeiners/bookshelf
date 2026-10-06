-- CreateTable
CREATE TABLE "BombStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "bestClassic" INTEGER NOT NULL DEFAULT 0,
    "bestManga" INTEGER NOT NULL DEFAULT 0,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BombStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

