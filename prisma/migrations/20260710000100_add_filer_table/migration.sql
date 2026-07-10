CREATE TABLE IF NOT EXISTS "Filer" (
  "id" TEXT NOT NULL,
  "tribeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filerCik" TEXT,
  "filerEntityId" TEXT NOT NULL,
  "companyEntityId" TEXT,
  "isMasterPersona" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Filer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Filer_tribeId_key" ON "Filer"("tribeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Filer_filerCik_key" ON "Filer"("filerCik");
CREATE UNIQUE INDEX IF NOT EXISTS "Filer_filerEntityId_key" ON "Filer"("filerEntityId");
CREATE UNIQUE INDEX IF NOT EXISTS "Filer_companyEntityId_key" ON "Filer"("companyEntityId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Filer_filerEntityId_fkey'
  ) THEN
    ALTER TABLE "Filer"
    ADD CONSTRAINT "Filer_filerEntityId_fkey"
    FOREIGN KEY ("filerEntityId") REFERENCES "Entity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Filer_companyEntityId_fkey'
  ) THEN
    ALTER TABLE "Filer"
    ADD CONSTRAINT "Filer_companyEntityId_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "Entity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Enable Row Level Security (RLS) for Supabase security
ALTER TABLE "Filer" ENABLE ROW LEVEL SECURITY;
