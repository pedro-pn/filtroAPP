CREATE TYPE "WorkforceClassification" AS ENUM ('OPERATIONAL', 'NON_OPERATIONAL', 'PENDING');
ALTER TABLE "JobRole"
  ADD COLUMN "workforceClassification" "WorkforceClassification",
  ADD COLUMN "classificationManagedLocally" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceIsOperational" BOOLEAN,
  ADD COLUMN "classificationVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Collaborator"
  ADD COLUMN "workforceClassificationOverride" "WorkforceClassification",
  ADD COLUMN "workforceSector" TEXT,
  ADD COLUMN "sourceIsOperational" BOOLEAN,
  ADD COLUMN "classificationVersion" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "WorkforceClassificationEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkforceClassificationEvent_entityType_entityId_createdAt_idx"
  ON "WorkforceClassificationEvent" ("entityType", "entityId", "createdAt");
CREATE INDEX "Collaborator_workforceClassificationOverride_jobRoleId_idx"
  ON "Collaborator" ("workforceClassificationOverride", "jobRoleId");
CREATE INDEX "JobRole_workforceClassification_isActive_idx"
  ON "JobRole" ("workforceClassification", "isActive");

-- Recover the original classification: the previous projection promoted any
-- published employment to operational, including administrative employees.
UPDATE "JobRole" r SET "sourceIsOperational" = (a.data->>'isOperational')::boolean
FROM "ConectaRhAggregate" a
WHERE a."aggregateType" = 'job_role' AND a."localId" = r.id
  AND jsonb_typeof(a.data->'isOperational') = 'boolean';
UPDATE "Collaborator" c SET "sourceIsOperational" = (a.data->>'isOperational')::boolean
FROM "ConectaRhAggregate" a
WHERE a."aggregateType" = 'employment' AND a."localId" = c.id
  AND a."externalId" = c."rhEmploymentId"
  AND jsonb_typeof(a.data->'isOperational') = 'boolean';

UPDATE "JobRole" SET "workforceClassification" = CASE
  WHEN "isOperational" IS false THEN 'NON_OPERATIONAL'::"WorkforceClassification"
  WHEN "sourceIsOperational" IS false THEN 'NON_OPERATIONAL'::"WorkforceClassification"
  WHEN "sourceIsOperational" IS true THEN 'OPERATIONAL'::"WorkforceClassification"
  WHEN "isOperational" THEN 'OPERATIONAL'::"WorkforceClassification"
  ELSE 'NON_OPERATIONAL'::"WorkforceClassification" END;
UPDATE "JobRole" SET "isOperational" = ("workforceClassification" = 'OPERATIONAL');
-- Mixed roles must not release a person explicitly classified as non-operational
-- by RH just because somebody else with the same title is operational.
UPDATE "Collaborator" SET "workforceClassificationOverride" = 'NON_OPERATIONAL'
WHERE "sourceIsOperational" IS false;

INSERT INTO "WorkforceClassificationEvent" (id, "entityType", "entityId", reason, before, after)
SELECT 'workforce-migration:role:' || id, 'JOB_ROLE', id,
  'Classificação inicial; classificação original do Conecta recuperada quando disponível.',
  '{}'::jsonb, jsonb_build_object('classification', "workforceClassification", 'sourceIsOperational', "sourceIsOperational")
FROM "JobRole";
INSERT INTO "WorkforceClassificationEvent" (id, "entityType", "entityId", reason, before, after)
SELECT 'workforce-migration:person:' || id, 'COLLABORATOR', id,
  'Não operacional segundo o vínculo original do Conecta.', '{}'::jsonb,
  jsonb_build_object('override', "workforceClassificationOverride")
FROM "Collaborator" WHERE "workforceClassificationOverride" IS NOT NULL;

-- Flag future/ongoing work, retaining all allocations and historical documents.
UPDATE "EfetivoMissionPlan" m SET "needsReplanning" = true,
  "replanningReason" = 'Equipe contém colaborador não operacional. Revise a classificação e a alocação.',
  version = version + 1
WHERE m."deletedAt" IS NULL AND m."scheduleStatus" <> 'CANCELLED'
  AND (m."returnDate" IS NULL OR m."returnDate" >= CURRENT_DATE)
  AND EXISTS (
    SELECT 1 FROM "EfetivoMissionAllocation" a
    JOIN "Collaborator" c ON c.id = a."collaboratorId"
    JOIN "JobRole" r ON r.id = c."jobRoleId"
    WHERE a."missionId" = m.id AND a."deletedAt" IS NULL
      AND COALESCE(c."workforceClassificationOverride", r."workforceClassification") <> 'OPERATIONAL'
  );
UPDATE "EfetivoPlan" p SET revision = revision + 1
WHERE EXISTS (SELECT 1 FROM "EfetivoMissionPlan" m WHERE m."planId" = p.id AND m."needsReplanning");
