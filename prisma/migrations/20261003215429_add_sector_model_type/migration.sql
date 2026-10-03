-- AlterTable
ALTER TABLE "Entity" ADD COLUMN "sectorModelType" TEXT;

-- CreateIndex
CREATE INDEX "Entity_sectorModelType_idx" ON "Entity"("sectorModelType");
