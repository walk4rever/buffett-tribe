-- CreateTable
CREATE TABLE "BeneficialOwnership" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "issuerEntityId" TEXT,
    "issuerCik" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "issuerTicker" TEXT,
    "securitiesClassTitle" TEXT,
    "eventDate" TIMESTAMP(3),
    "sharesOwned" BIGINT,
    "percentOfClass" DOUBLE PRECISION,
    "soleVotingPower" BIGINT,
    "sharedVotingPower" BIGINT,
    "soleDispositivePower" BIGINT,
    "sharedDispositivePower" BIGINT,
    "isGroupFiling" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeneficialOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BeneficialOwnership_sourceId_key" ON "BeneficialOwnership"("sourceId");

-- CreateIndex
CREATE INDEX "BeneficialOwnership_issuerCik_idx" ON "BeneficialOwnership"("issuerCik");

-- AddForeignKey
ALTER TABLE "BeneficialOwnership" ADD CONSTRAINT "BeneficialOwnership_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExtSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficialOwnership" ADD CONSTRAINT "BeneficialOwnership_issuerEntityId_fkey" FOREIGN KEY ("issuerEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
