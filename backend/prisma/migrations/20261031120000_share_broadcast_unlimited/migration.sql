-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarCardId" TEXT,
    "avatarUrl" TEXT,
    "featuredCardIds" TEXT NOT NULL DEFAULT '[]',
    "activeTitle" TEXT,
    "boostersOpened" INTEGER NOT NULL DEFAULT 0,
    "isProfilePublic" BOOLEAN NOT NULL DEFAULT true,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'fr',
    "oracleLastDay" TEXT,
    "oracleStreak" INTEGER NOT NULL DEFAULT 0,
    "oracleBest" INTEGER NOT NULL DEFAULT 0,
    "emailVerifiedAt" DATETIME,
    "imageReviewer" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" DATETIME,
    "suspendedReason" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME,
    "stardust" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("activeTitle", "avatarCardId", "avatarUrl", "bio", "boostersOpened", "createdAt", "displayName", "email", "emailVerifiedAt", "featuredCardIds", "id", "imageReviewer", "isProfilePublic", "lastSeenAt", "oracleBest", "oracleLastDay", "oracleStreak", "passwordHash", "preferredLanguage", "sessionVersion", "stardust", "suspendedAt", "suspendedReason", "updatedAt") SELECT "activeTitle", "avatarCardId", "avatarUrl", "bio", "boostersOpened", "createdAt", "displayName", "email", "emailVerifiedAt", "featuredCardIds", "id", "imageReviewer", "isProfilePublic", "lastSeenAt", "oracleBest", "oracleLastDay", "oracleStreak", "passwordHash", "preferredLanguage", "sessionVersion", "stardust", "suspendedAt", "suspendedReason", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

