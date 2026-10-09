CREATE TABLE "ProjectPresentationCopy" (
  "id" TEXT PRIMARY KEY,
  "sourceProjectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "ProjectPresentationCopy_active_source_key"
  ON "ProjectPresentationCopy"("sourceProjectId") WHERE "endedAt" IS NULL;
