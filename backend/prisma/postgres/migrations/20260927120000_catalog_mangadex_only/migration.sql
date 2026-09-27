-- Catalogue reconstruit sur MangaDex seul (AniList retiré). C'est un cache :
-- on le vide, et l'indexeur le remplit de nouveau au prochain démarrage.
DROP TABLE "CatalogWork";

CREATE TABLE "CatalogWork" (
    "mangadexId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "rating" DOUBLE PRECISION,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "genres" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "mangadex" TEXT NOT NULL,
    "status" TEXT,
    "chapters" INTEGER,
    "year" INTEGER,
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogWork_pkey" PRIMARY KEY ("mangadexId")
);

CREATE INDEX "CatalogWork_country_popularity_idx" ON "CatalogWork"("country", "popularity");

-- Aucune indexation n'est plus « fraîche » : elle repart au démarrage.
DELETE FROM "CatalogSync";
