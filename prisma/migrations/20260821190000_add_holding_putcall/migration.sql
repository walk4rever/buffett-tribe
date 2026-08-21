-- DropIndex
DROP INDEX "Holding_holderEntityId_securityId_asOfDate_key";

-- AlterTable
ALTER TABLE "Holding" ADD COLUMN     "putCall" TEXT NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE UNIQUE INDEX "Holding_holderEntityId_securityId_asOfDate_putCall_key" ON "Holding"("holderEntityId", "securityId", "asOfDate", "putCall");
