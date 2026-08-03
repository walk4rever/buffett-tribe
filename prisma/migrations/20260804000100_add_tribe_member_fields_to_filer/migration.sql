-- Curated presentation fields for src/lib/tribe.ts (DB-driven tribe member
-- data, replacing the hardcoded TRIBE_MEMBERS array).
ALTER TABLE "Filer"
  ADD COLUMN "personNameEn"  TEXT,
  ADD COLUMN "personNameZh"  TEXT,
  ADD COLUMN "initials"      TEXT,
  ADD COLUMN "materialLabel" TEXT NOT NULL DEFAULT '访谈与观点',
  ADD COLUMN "materialSub"   TEXT NOT NULL DEFAULT '建设中';
