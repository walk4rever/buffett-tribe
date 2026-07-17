-- Security.isPrimary never had a write path (always default false); drop it, Entity.ticker is the canonical ticker
ALTER TABLE "Security" DROP COLUMN IF EXISTS "isPrimary";
