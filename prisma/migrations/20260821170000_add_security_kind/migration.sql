-- AlterTable
ALTER TABLE "Security" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'unclassified';

-- CreateIndex
CREATE INDEX "Security_kind_idx" ON "Security"("kind");
