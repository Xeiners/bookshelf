-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'fr',
    "oracleLastDay" TEXT,
    "oracleStreak" INTEGER NOT NULL DEFAULT 0,
    "oracleBest" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryEntry" (
    "userId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "userRating" DOUBLE PRECISION,
    "snapshot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryEntry_pkey" PRIMARY KEY ("userId","workId")
);

-- CreateTable
CREATE TABLE "SkippedWork" (
    "userId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkippedWork_pkey" PRIMARY KEY ("userId","workId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "scores" TEXT NOT NULL DEFAULT '{"genres":{},"tags":{}}',
    "swipes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CatalogWork" (
    "anilistId" INTEGER NOT NULL,
    "mangadexId" TEXT,
    "country" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "meanScore" INTEGER,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "genres" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "anilist" TEXT NOT NULL,
    "mangadex" TEXT,
    "mdRating" DOUBLE PRECISION,
    "status" TEXT,
    "chapters" INTEGER,
    "year" INTEGER,
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogWork_pkey" PRIMARY KEY ("anilistId")
);

-- CreateTable
CREATE TABLE "CatalogSync" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "LibraryEntry_userId_status_idx" ON "LibraryEntry"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogWork_mangadexId_key" ON "CatalogWork"("mangadexId");

-- CreateIndex
CREATE INDEX "CatalogWork_country_popularity_idx" ON "CatalogWork"("country", "popularity");

-- AddForeignKey
ALTER TABLE "LibraryEntry" ADD CONSTRAINT "LibraryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkippedWork" ADD CONSTRAINT "SkippedWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

