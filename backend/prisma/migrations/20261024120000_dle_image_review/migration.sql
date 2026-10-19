-- CreateTable
CREATE TABLE "DleImageReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DleImageReview_category_status_idx" ON "DleImageReview"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DleImageReview_category_characterId_imageKey_key" ON "DleImageReview"("category", "characterId", "imageKey");
