-- AlterTable
ALTER TABLE "JumpStats" ADD COLUMN     "character" TEXT NOT NULL DEFAULT 'moon';

-- CreateTable
CREATE TABLE "JumpCharacter" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JumpCharacter_pkey" PRIMARY KEY ("userId","characterId")
);

-- AddForeignKey
ALTER TABLE "JumpCharacter" ADD CONSTRAINT "JumpCharacter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

