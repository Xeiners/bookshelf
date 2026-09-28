-- CreateTable
CREATE TABLE "UserBook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "coverUrl" TEXT,
    "filePath" TEXT NOT NULL,
    "coverPath" TEXT,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'EPUB',
    "originalName" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL DEFAULT '',
    "language" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "pages" INTEGER,
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCfi" TEXT,
    "progressAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserBook_userId_updatedAt_idx" ON "UserBook"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserBook_userId_sha256_key" ON "UserBook"("userId", "sha256");

-- AddForeignKey
ALTER TABLE "UserBook" ADD CONSTRAINT "UserBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

