-- CreateTable
CREATE TABLE "CanvasSeason" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "archive" TEXT,
    "stats" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "CanvasSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasObject" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "minX" DOUBLE PRECISION NOT NULL,
    "minY" DOUBLE PRECISION NOT NULL,
    "maxX" DOUBLE PRECISION NOT NULL,
    "maxY" DOUBLE PRECISION NOT NULL,
    "cx" INTEGER NOT NULL,
    "cy" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasLike" (
    "objectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasLike_pkey" PRIMARY KEY ("objectId","userId")
);

-- CreateTable
CREATE TABLE "CanvasReport" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CanvasReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasProfile" (
    "userId" TEXT NOT NULL,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" TEXT,
    "brushes" TEXT NOT NULL DEFAULT '[]',
    "likesReceived" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "likesGivenToday" INTEGER NOT NULL DEFAULT 0,
    "rewardedToday" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanvasSeason_key_key" ON "CanvasSeason"("key");

-- CreateIndex
CREATE INDEX "CanvasObject_seasonId_cx_cy_idx" ON "CanvasObject"("seasonId", "cx", "cy");

-- CreateIndex
CREATE INDEX "CanvasObject_seasonId_type_idx" ON "CanvasObject"("seasonId", "type");

-- CreateIndex
CREATE INDEX "CanvasObject_seasonId_createdAt_idx" ON "CanvasObject"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasObject_ownerId_seasonId_idx" ON "CanvasObject"("ownerId", "seasonId");

-- CreateIndex
CREATE INDEX "CanvasLike_userId_createdAt_idx" ON "CanvasLike"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasReport_resolvedAt_createdAt_idx" ON "CanvasReport"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasReport_objectId_reporterId_key" ON "CanvasReport"("objectId", "reporterId");

-- AddForeignKey
ALTER TABLE "CanvasObject" ADD CONSTRAINT "CanvasObject_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CanvasSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasObject" ADD CONSTRAINT "CanvasObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasLike" ADD CONSTRAINT "CanvasLike_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "CanvasObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasLike" ADD CONSTRAINT "CanvasLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReport" ADD CONSTRAINT "CanvasReport_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "CanvasObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReport" ADD CONSTRAINT "CanvasReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasProfile" ADD CONSTRAINT "CanvasProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
