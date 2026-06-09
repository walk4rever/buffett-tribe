CREATE TABLE "InsightPost" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT,
  "sourceUrl" TEXT,
  "author" TEXT,
  "publishedAt" TIMESTAMP(3),
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "format" TEXT NOT NULL DEFAULT 'markdown',
  "contentRaw" TEXT NOT NULL,
  "contentHtml" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published',
  "externalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InsightPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsightPost_slug_key" ON "InsightPost"("slug");
CREATE UNIQUE INDEX "InsightPost_externalId_key" ON "InsightPost"("externalId");
CREATE INDEX "InsightPost_status_publishedAt_idx" ON "InsightPost"("status", "publishedAt");
CREATE INDEX "InsightPost_status_updatedAt_idx" ON "InsightPost"("status", "updatedAt");

-- Enable Row Level Security (RLS) for Supabase security
ALTER TABLE "InsightPost" ENABLE ROW LEVEL SECURITY;
