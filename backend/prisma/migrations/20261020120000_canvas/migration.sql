-- CreateTable
CREATE TABLE "CanvasSeason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "archive" TEXT,
    "stats" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "CanvasObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "minX" REAL NOT NULL,
    "minY" REAL NOT NULL,
    "maxX" REAL NOT NULL,
    "maxY" REAL NOT NULL,
    "cx" INTEGER NOT NULL,
    "cy" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "hiddenAt" DATETIME,
    "hiddenReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasObject_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CanvasSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanvasLike" (
    "objectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("objectId", "userId"),
    CONSTRAINT "CanvasLike_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "CanvasObject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanvasReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objectId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "CanvasReport_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "CanvasObject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanvasProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "bannedAt" DATETIME,
    "bannedReason" TEXT,
    "brushes" TEXT NOT NULL DEFAULT '[]',
    "likesReceived" INTEGER NOT NULL DEFAULT 0,
    "day" TEXT,
    "likesGivenToday" INTEGER NOT NULL DEFAULT 0,
    "rewardedToday" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
