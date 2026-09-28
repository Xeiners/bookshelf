ALTER TABLE "UserBook" ADD COLUMN "workId" TEXT;

CREATE UNIQUE INDEX "UserBook_userId_workId_key" ON "UserBook"("userId", "workId");
