-- CreateTable
CREATE TABLE "Punch" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "filerEntityId" TEXT,
    "companyEntityId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "headline" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "catalyst" TEXT,
    "valuation" TEXT,
    "risk" TEXT,
    "quotes" JSONB,
    "entrySummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Punch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Punch_slug_key" ON "Punch"("slug");

-- CreateIndex
CREATE INDEX "Punch_status_idx" ON "Punch"("status");

-- CreateIndex
CREATE INDEX "Punch_filerEntityId_idx" ON "Punch"("filerEntityId");

-- CreateIndex
CREATE INDEX "Punch_companyEntityId_idx" ON "Punch"("companyEntityId");

-- AddForeignKey
ALTER TABLE "Punch" ADD CONSTRAINT "Punch_filerEntityId_fkey" FOREIGN KEY ("filerEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Punch" ADD CONSTRAINT "Punch_companyEntityId_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
