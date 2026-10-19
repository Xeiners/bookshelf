-- CreateTable
CREATE TABLE "DleImageReview" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DleImageReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DleImageReview_category_status_idx" ON "DleImageReview"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DleImageReview_category_characterId_imageKey_key" ON "DleImageReview"("category", "characterId", "imageKey");
