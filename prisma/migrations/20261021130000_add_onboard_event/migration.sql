CREATE TABLE "OnboardEvent" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "entityId" TEXT,
  "ticker" TEXT,
  "market" TEXT,
  "phase" INTEGER NOT NULL,
  "targetPhase" INTEGER,
  "result" TEXT NOT NULL,
  "errorCategory" TEXT,
  "errorMessage" TEXT,
  "elapsedMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OnboardEvent_batchId_idx" ON "OnboardEvent"("batchId");
CREATE INDEX "OnboardEvent_createdAt_idx" ON "OnboardEvent"("createdAt");
CREATE INDEX "OnboardEvent_result_createdAt_idx" ON "OnboardEvent"("result", "createdAt");

ALTER TABLE "OnboardEvent"
ADD CONSTRAINT "OnboardEvent_entityId_fkey"
FOREIGN KEY ("entityId") REFERENCES "Entity"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
