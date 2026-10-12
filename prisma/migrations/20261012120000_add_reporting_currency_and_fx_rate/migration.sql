ALTER TABLE "Entity"
ADD COLUMN "reportingCurrency" TEXT;

CREATE TABLE "FxRate" (
    "currency" TEXT NOT NULL,
    "rateToUsd" DECIMAL(20,10) NOT NULL,
    "asOfDate" DATE NOT NULL,
    "ticker" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'yahoo-chart',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("currency")
);
