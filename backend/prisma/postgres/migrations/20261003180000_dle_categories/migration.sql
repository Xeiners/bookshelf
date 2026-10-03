-- BookshelfDLE : catégories (mangas, Naruto). Les énigmes et parties existantes restent dans « manga ».
ALTER TABLE "DleDaily" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'manga';
ALTER TABLE "DleDaily" DROP CONSTRAINT "DleDaily_pkey";
ALTER TABLE "DleDaily" ADD CONSTRAINT "DleDaily_pkey" PRIMARY KEY ("userId", "day", "category", "mode");

ALTER TABLE "DlePuzzle" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'manga';
ALTER TABLE "DlePuzzle" DROP CONSTRAINT "DlePuzzle_pkey";
ALTER TABLE "DlePuzzle" ADD CONSTRAINT "DlePuzzle_pkey" PRIMARY KEY ("day", "category", "mode");
