-- CreateTable
CREATE TABLE "JumpStats" (
    "userId" TEXT NOT NULL,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestHeight" INTEGER NOT NULL DEFAULT 0,
    "bestAt" TIMESTAMP(3),
    "games" INTEGER NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "stomps" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JumpStats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "JumpStats_best_idx" ON "JumpStats"("best");

-- AddForeignKey
ALTER TABLE "JumpStats" ADD CONSTRAINT "JumpStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

