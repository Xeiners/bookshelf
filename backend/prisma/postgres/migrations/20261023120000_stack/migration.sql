-- CreateTable
CREATE TABLE "StackStats" (
    "userId" TEXT NOT NULL,
    "best" INTEGER NOT NULL DEFAULT 0,
    "bestPages" INTEGER NOT NULL DEFAULT 0,
    "bestAt" TIMESTAMP(3),
    "games" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "perfects" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "dayEarned" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StackStats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "StackStats_best_idx" ON "StackStats"("best");

-- AddForeignKey
ALTER TABLE "StackStats" ADD CONSTRAINT "StackStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
