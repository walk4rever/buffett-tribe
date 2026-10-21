ALTER TABLE "Entity"
ADD COLUMN "retryExhaustedStage" INTEGER;

CREATE INDEX "Entity_retryExhaustedStage_idx"
ON "Entity"("retryExhaustedStage");
