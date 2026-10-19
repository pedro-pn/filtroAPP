-- Não excluir nem renumerar duplicatas históricas do Access: podem estar selecionadas.
ALTER TABLE "CommercialProposal" ADD COLUMN "legacyDuplicate" BOOLEAN NOT NULL DEFAULT false;
UPDATE "CommercialProposal" p SET "legacyDuplicate" = true
FROM (SELECT id, row_number() OVER (PARTITION BY "codProp", "nRev" ORDER BY "codBd") AS ordinal
      FROM "CommercialProposal") d WHERE p.id = d.id AND d.ordinal > 1;
CREATE UNIQUE INDEX "CommercialProposal_revision_identity" ON "CommercialProposal" ("codProp", "nRev") WHERE NOT "legacyDuplicate";

ALTER TABLE "CommercialAppProposal"
  ADD COLUMN "proposalKind" TEXT NOT NULL DEFAULT 'MAIN',
  ADD COLUMN "parentProposalCode" TEXT,
  ADD COLUMN "additionalProposalId" TEXT,
  ADD COLUMN "sourceProposalId" TEXT,
  ADD COLUMN "sourceRevisionNumber" INTEGER,
  ADD COLUMN "prismaProjectId" TEXT;
ALTER TABLE "CommercialAppProposal" ADD CONSTRAINT "CommercialAppProposal_additional_identity" CHECK (
  ("proposalKind" = 'MAIN' AND "parentProposalCode" IS NULL AND "additionalProposalId" IS NULL) OR
  ("proposalKind" = 'ADDITIONAL' AND "parentProposalCode" IS NOT NULL AND "additionalProposalId" IS NOT NULL
   AND "parentProposalCode" <> "proposalCode"));
ALTER TABLE "CommercialAppDelivery" ADD COLUMN "acknowledgement" JSONB;

ALTER TABLE "ProjectAdditionalProposal"
  ALTER COLUMN "codProp" DROP NOT NULL, ALTER COLUMN "sourceProposalCodBd" DROP NOT NULL,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ACCESS_IMPORT',
  ADD COLUMN "proposalCode" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "commercialAppProposalId" TEXT,
  ADD COLUMN "selectionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "selectionOrigin" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scopeImport" JSONB;
UPDATE "ProjectAdditionalProposal" SET "proposalCode" = "codProp"::text;
-- Compatibilidade com scripts e integrações Access que ainda só fornecem codProp.
CREATE FUNCTION fill_additional_access_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'ACCESS_IMPORT' AND NEW."proposalCode" = '' THEN NEW."proposalCode" := NEW."codProp"::text; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectAdditionalProposal_access_identity" BEFORE INSERT OR UPDATE ON "ProjectAdditionalProposal"
FOR EACH ROW EXECUTE FUNCTION fill_additional_access_identity();
ALTER TABLE "ProjectAdditionalProposal" ADD CONSTRAINT "ProjectAdditionalProposal_origin_reference" CHECK (
  (source = 'ACCESS_IMPORT' AND "sourceProposalCodBd" IS NOT NULL AND "codProp" IS NOT NULL
   AND "proposalCode" = "codProp"::text AND "commercialAppProposalId" IS NULL) OR
  (source = 'COMERCIAL_APP' AND "sourceProposalCodBd" IS NULL AND "codProp" IS NULL AND "commercialAppProposalId" IS NOT NULL)
);
CREATE UNIQUE INDEX "ProjectAdditionalProposal_projectId_source_proposalCode_key"
ON "ProjectAdditionalProposal" ("projectId", source, "proposalCode");

CREATE TABLE "ProjectContributionEvent" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  source TEXT NOT NULL, "proposalCode" TEXT NOT NULL, "selectionVersion" INTEGER NOT NULL,
  operation TEXT NOT NULL, "actorUserId" TEXT, reason TEXT, data JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ProjectContributionEvent_projectId_source_proposalCode_selectionVersion_key"
ON "ProjectContributionEvent" ("projectId", source, "proposalCode", "selectionVersion");
CREATE TABLE "CommercialProposalSyncJob" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "proposalCode" TEXT NOT NULL, state JSONB NOT NULL, "nextAttemptAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "CommercialProposalSyncJob_projectId_proposalCode_key" ON "CommercialProposalSyncJob" ("projectId", "proposalCode");
CREATE INDEX "CommercialProposalSyncJob_nextAttemptAt_idx" ON "CommercialProposalSyncJob" ("nextAttemptAt");

ALTER TABLE "ProjectPlannedService" ADD COLUMN "contributionKey" TEXT;
-- Escopo com override é manual. Atribuir somente importações reconhecidas.
UPDATE "ProjectPlannedService" s SET "contributionKey" = 'COMERCIAL_APP:' || p."proposalCode"
FROM "Project" j JOIN "CommercialAppProposal" p ON p."externalId" = j."commercialScopeImport"->>'externalId'
WHERE s."projectId" = j.id AND COALESCE(j."commercialScopeImport"->>'status', '') <> 'MANUAL_OVERRIDE';
-- Migra também a identidade dos documentos já sincronizados, preservando o histórico.
UPDATE "ProjectDocumentVersion" SET "externalId" = 'comercialapp:' || split_part("sourceVersion", ':', 1) || ':' || split_part("externalId", ':', 2)
WHERE source = 'SYSTEM' AND "externalId" IN ('comercialapp:COMMERCIAL_PROPOSAL', 'comercialapp:TECHNICAL_PROPOSAL')
  AND "sourceVersion" ~ '^[0-9]+:';

CREATE FUNCTION guard_commercial_additional_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."proposalKind" = 'ADDITIONAL' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('commercial-additional:' || NEW."proposalCode", 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('commercial-additional-id:' || NEW."additionalProposalId", 0));
    IF EXISTS (SELECT 1 FROM "CommercialAppProposal" p WHERE p.id <> NEW.id
      AND (p."proposalCode" = NEW."proposalCode" OR p."additionalProposalId" = NEW."additionalProposalId")
      AND (p."proposalCode" IS DISTINCT FROM NEW."proposalCode"
        OR p."additionalProposalId" IS DISTINCT FROM NEW."additionalProposalId"
        OR p."parentProposalCode" IS DISTINCT FROM NEW."parentProposalCode"
        OR p."projectId" IS DISTINCT FROM NEW."projectId"
        OR regexp_replace(p."clientCnpj", '[^0-9]', '', 'g') IS DISTINCT FROM regexp_replace(NEW."clientCnpj", '[^0-9]', '', 'g')
        OR p."sourceProposalId" IS DISTINCT FROM NEW."sourceProposalId"
        OR p."sourceRevisionNumber" IS DISTINCT FROM NEW."sourceRevisionNumber")) THEN
      RAISE EXCEPTION 'Identidade estável de adicional divergente' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."proposalCode" IS DISTINCT FROM NEW."proposalCode"
    OR OLD."revisionNumber" IS DISTINCT FROM NEW."revisionNumber"
    OR OLD."externalId" IS DISTINCT FROM NEW."externalId"
    OR OLD."proposalKind" IS DISTINCT FROM NEW."proposalKind"
    OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
    OR OLD."parentProposalCode" IS DISTINCT FROM NEW."parentProposalCode"
    OR OLD."additionalProposalId" IS DISTINCT FROM NEW."additionalProposalId") THEN
    RAISE EXCEPTION 'Identidade de revisão imutável' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommercialAppProposal_stable_identity" BEFORE INSERT OR UPDATE ON "CommercialAppProposal"
FOR EACH ROW EXECUTE FUNCTION guard_commercial_additional_identity();

CREATE FUNCTION guard_access_legacy_duplicate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."legacyDuplicate" AND (TG_OP = 'INSERT' OR NOT OLD."legacyDuplicate"
    OR OLD."codProp" IS DISTINCT FROM NEW."codProp" OR OLD."nRev" IS DISTINCT FROM NEW."nRev") THEN
    RAISE EXCEPTION 'Novas duplicatas de revisão Access não são permitidas' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommercialProposal_legacy_duplicate_guard" BEFORE INSERT OR UPDATE ON "CommercialProposal"
FOR EACH ROW EXECUTE FUNCTION guard_access_legacy_duplicate();
