-- Le commutateur couvre désormais tout le profil public, plus seulement les lectures.
ALTER TABLE "User" RENAME COLUMN "isLibraryPublic" TO "isProfilePublic";
