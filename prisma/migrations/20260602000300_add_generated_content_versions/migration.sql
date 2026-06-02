CREATE TABLE "GeneratedContentVersion" (
  "id" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "artifactType" TEXT NOT NULL,
  "versionSeq" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'llm',
  "promptVersion" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GeneratedContentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneratedContentVersion_scopeType_scopeId_artifactType_versionSeq_key"
  ON "GeneratedContentVersion" ("scopeType", "scopeId", "artifactType", "versionSeq");

CREATE INDEX "GeneratedContentVersion_scopeType_scopeId_artifactType_idx"
  ON "GeneratedContentVersion" ("scopeType", "scopeId", "artifactType");

CREATE INDEX "GeneratedContentVersion_artifactType_idx"
  ON "GeneratedContentVersion" ("artifactType");
