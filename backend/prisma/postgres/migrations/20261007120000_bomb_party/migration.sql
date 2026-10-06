-- CreateTable
CREATE TABLE "BombStats" (
    "userId" TEXT NOT NULL,
    "bestClassic" INTEGER NOT NULL DEFAULT 0,
    "bestManga" INTEGER NOT NULL DEFAULT 0,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BombStats_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "BombStats" ADD CONSTRAINT "BombStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

