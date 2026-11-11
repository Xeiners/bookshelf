-- CreateTable
CREATE TABLE "GravityLevel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "data" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GravityLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GravityProgress" (
    "userId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "bestPercent" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "bestTimeMs" INTEGER,
    "fewestDeaths" INTEGER,
    "scrolls" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GravityProgress_pkey" PRIMARY KEY ("userId","levelId")
);

-- CreateIndex
CREATE INDEX "GravityLevel_position_idx" ON "GravityLevel"("position");

-- CreateIndex
CREATE INDEX "GravityProgress_levelId_idx" ON "GravityProgress"("levelId");

-- AddForeignKey
ALTER TABLE "GravityProgress" ADD CONSTRAINT "GravityProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GravityProgress" ADD CONSTRAINT "GravityProgress_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "GravityLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

