-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
