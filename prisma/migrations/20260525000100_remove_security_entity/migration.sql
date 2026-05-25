-- DropForeignKey
ALTER TABLE "Security" DROP CONSTRAINT "Security_entityId_fkey";

-- DropForeignKey
ALTER TABLE "Holding" DROP CONSTRAINT "Holding_securityEntityId_fkey";

-- DropForeignKey
ALTER TABLE "Holding" DROP CONSTRAINT "Holding_securityId_fkey";

-- DropIndex
DROP INDEX "Security_entityId_key";

-- DropIndex
DROP INDEX "Holding_securityEntityId_asOfDate_idx";

-- DropIndex
DROP INDEX "Holding_holderEntityId_securityEntityId_asOfDate_key";

-- AlterTable
ALTER TABLE "Security" DROP COLUMN "entityId";

-- AlterTable
ALTER TABLE "Holding" DROP COLUMN "securityEntityId",
ALTER COLUMN "securityId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Holding_holderEntityId_securityId_asOfDate_key" ON "Holding"("holderEntityId", "securityId", "asOfDate");

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;
