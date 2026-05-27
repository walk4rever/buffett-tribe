-- Add raw filing artifact archive layer.
-- Stores object storage metadata for primary HTML, index HTML, exhibits and SEC data files.

-- CreateTable
CREATE TABLE "FilingArtifact" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT,
    "sourceUrl" TEXT,
    "publicUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilingArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingArtifact_objectKey_key" ON "FilingArtifact"("objectKey");

-- CreateIndex
CREATE INDEX "FilingArtifact_sourceId_kind_idx" ON "FilingArtifact"("sourceId", "kind");

-- CreateIndex
CREATE INDEX "FilingArtifact_sha256_idx" ON "FilingArtifact"("sha256");

-- AddForeignKey
ALTER TABLE "FilingArtifact" ADD CONSTRAINT "FilingArtifact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExtSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
