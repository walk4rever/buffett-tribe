-- The legacy SEC mapping copied each year's ending-cash tag into the
-- beginning-cash line. Clear only ASML FY values that exactly duplicate the
-- matching CashEndOfPeriod row; do not infer missing opening balances.
UPDATE "Financial" AS opening
SET "value" = NULL
FROM "Entity" AS entity
WHERE opening."entityId" = entity."id"
  AND entity."type" = 'company'
  AND upper(entity."ticker") = 'ASML'
  AND opening."periodType" = 'FY'
  AND opening."lineItem" = 'CashBeginningOfPeriod'
  AND opening."value" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "Financial" AS ending
    WHERE ending."entityId" = opening."entityId"
      AND ending."periodEnd" = opening."periodEnd"
      AND ending."periodType" = opening."periodType"
      AND ending."lineItem" = 'CashEndOfPeriod'
      AND ending."value" = opening."value"
  );
