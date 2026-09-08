-- Esta migration separa dados compartilhados produtivos dos modelos ainda inéditos do Efetivo.
-- Execute primeiro backend/scripts/backfill-collaborator-job-roles.mjs --dry-run.

CREATE TYPE "EpiRoleSource" AS ENUM ('CANONICAL', 'EPI_OVERRIDE');
CREATE TYPE "WorkforceHolidaySource" AS ENUM ('COMPANY');

ALTER TABLE "JobRole" ADD COLUMN "normalizedKey" TEXT;

UPDATE "JobRole"
SET "normalizedKey" = regexp_replace(
  translate(
    lower(trim("name")),
    'áàãâäéèêëíìîïóòõôöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  ),
  '\s+',
  ' ',
  'g'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "JobRole"
    GROUP BY "normalizedKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existem cargos duplicados pela chave normalizada; resolva antes da migration.';
  END IF;
END $$;

ALTER TABLE "JobRole" ALTER COLUMN "normalizedKey" SET NOT NULL;
CREATE UNIQUE INDEX "JobRole_normalizedKey_key" ON "JobRole"("normalizedKey");

-- Nomes legados ainda não cadastrados passam a existir como cargos canônicos provisórios.
-- Um único cargo é criado por chave normalizada e pode ser renomeado pelo gestor depois.
WITH legacy_role_names AS (
  SELECT trim("role") AS name
  FROM "Collaborator"
  WHERE "jobRoleId" IS NULL
    AND nullif(trim("role"), '') IS NOT NULL

  UNION ALL

  SELECT trim("epiRoleOverride") AS name
  FROM "Collaborator"
  WHERE nullif(trim("epiRoleOverride"), '') IS NOT NULL
), normalized_legacy_roles AS (
  SELECT
    name,
    regexp_replace(
      translate(
        lower(name),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '\s+',
      ' ',
      'g'
    ) AS normalized_key
  FROM legacy_role_names
), missing_roles AS (
  SELECT DISTINCT ON (legacy.normalized_key)
    legacy.name,
    legacy.normalized_key
  FROM normalized_legacy_roles legacy
  WHERE legacy.normalized_key <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM "JobRole" job_role
      WHERE job_role."normalizedKey" = legacy.normalized_key
    )
  ORDER BY legacy.normalized_key, legacy.name
)
INSERT INTO "JobRole" ("id", "name", "normalizedKey", "updatedAt")
SELECT gen_random_uuid()::text, name, normalized_key, CURRENT_TIMESTAMP
FROM missing_roles
ON CONFLICT ("normalizedKey") DO NOTHING;

WITH matched_roles AS (
  SELECT collaborator."id" AS collaborator_id, job_role."id" AS job_role_id
  FROM "Collaborator" collaborator
  JOIN "JobRole" job_role
    ON job_role."normalizedKey" = regexp_replace(
      translate(
        lower(trim(collaborator."role")),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '\s+',
      ' ',
      'g'
    )
  WHERE collaborator."jobRoleId" IS NULL
)
UPDATE "Collaborator" collaborator
SET "jobRoleId" = matched_roles.job_role_id
FROM matched_roles
WHERE collaborator."id" = matched_roles.collaborator_id;

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM "Collaborator"
  WHERE "jobRoleId" IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem % colaboradores sem cargo canônico; execute o diagnóstico e resolva as pendências.', missing_count;
  END IF;
END $$;

CREATE TABLE "EpiCollaboratorProfile" (
  "collaboratorId" TEXT NOT NULL,
  "roleOverrideJobRoleId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpiCollaboratorProfile_pkey" PRIMARY KEY ("collaboratorId")
);

INSERT INTO "EpiCollaboratorProfile" (
  "collaboratorId",
  "roleOverrideJobRoleId",
  "createdAt",
  "updatedAt"
)
SELECT
  collaborator."id",
  job_role."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Collaborator" collaborator
JOIN "JobRole" job_role
  ON job_role."normalizedKey" = regexp_replace(
    translate(
      lower(trim(collaborator."epiRoleOverride")),
      'áàãâäéèêëíìîïóòõôöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '\s+',
    ' ',
    'g'
  )
WHERE nullif(trim(collaborator."epiRoleOverride"), '') IS NOT NULL;

DO $$
DECLARE
  unresolved_count integer;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM "Collaborator" collaborator
  LEFT JOIN "EpiCollaboratorProfile" profile
    ON profile."collaboratorId" = collaborator."id"
  WHERE nullif(trim(collaborator."epiRoleOverride"), '') IS NOT NULL
    AND profile."collaboratorId" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem % overrides EPI sem cargo canônico; resolva antes da migration.', unresolved_count;
  END IF;
END $$;

ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN "jobRoleIdSnapshot" TEXT,
  ADD COLUMN "roleNameSnapshot" TEXT,
  ADD COLUMN "roleSourceSnapshot" "EpiRoleSource";

UPDATE "EpiSignatureRequest" request
SET
  "jobRoleIdSnapshot" = COALESCE(profile."roleOverrideJobRoleId", collaborator."jobRoleId"),
  "roleNameSnapshot" = COALESCE(override_role."name", canonical_role."name"),
  "roleSourceSnapshot" = CASE
    WHEN profile."roleOverrideJobRoleId" IS NOT NULL THEN 'EPI_OVERRIDE'::"EpiRoleSource"
    ELSE 'CANONICAL'::"EpiRoleSource"
  END
FROM "Collaborator" collaborator
LEFT JOIN "EpiCollaboratorProfile" profile
  ON profile."collaboratorId" = collaborator."id"
LEFT JOIN "JobRole" override_role
  ON override_role."id" = profile."roleOverrideJobRoleId"
JOIN "JobRole" canonical_role
  ON canonical_role."id" = collaborator."jobRoleId"
WHERE request."collaboratorId" = collaborator."id";

ALTER TABLE "EpiSignatureRequest"
  ALTER COLUMN "roleNameSnapshot" SET NOT NULL,
  ALTER COLUMN "roleSourceSnapshot" SET NOT NULL;

ALTER TABLE "Report"
  ADD COLUMN "efetivoMissionId" TEXT,
  ADD COLUMN "efetivoPlanRevision" INTEGER;

ALTER TABLE "ReportCollaborator"
  ADD COLUMN "jobRoleIdSnapshot" TEXT,
  ADD COLUMN "roleNameSnapshot" TEXT;

UPDATE "ReportCollaborator" link
SET
  "jobRoleIdSnapshot" = collaborator."jobRoleId",
  "roleNameSnapshot" = job_role."name"
FROM "Collaborator" collaborator
JOIN "JobRole" job_role ON job_role."id" = collaborator."jobRoleId"
WHERE link."collaboratorId" = collaborator."id";

ALTER TABLE "CollaboratorAbsence"
  ADD COLUMN "updatedByUserId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "EfetivoPlan"
  ADD COLUMN "baseCalendarRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "EfetivoMissionPlan"
  ADD COLUMN "headquartersResponsibleUserId" TEXT,
  ADD COLUMN "needsReplanning" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replanningReason" TEXT;

UPDATE "EfetivoMissionPlan" mission
SET "headquartersResponsibleUserId" = mission."createdByUserId"
WHERE mission."createdByUserId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "User" actor WHERE actor."id" = mission."createdByUserId");

UPDATE "EfetivoMissionPlan" mission
SET "headquartersResponsibleUserId" = responsible_user."id"
FROM "User" responsible_user
WHERE mission."headquartersResponsibleUserId" IS NULL
  AND mission."headquartersResponsibleCollaboratorId" IS NOT NULL
  AND responsible_user."collaboratorId" = mission."headquartersResponsibleCollaboratorId";

-- Efetivo ainda não possui dados produtivos: programações locais sem identidade de User
-- são descartadas para permitir que o modelo final já nasça com a FK obrigatória.
DELETE FROM "EfetivoMissionPlan"
WHERE "headquartersResponsibleUserId" IS NULL;

ALTER TABLE "EfetivoMissionPlan"
  ALTER COLUMN "headquartersResponsibleUserId" SET NOT NULL;

ALTER TABLE "EfetivoHoliday" RENAME TO "WorkforceHoliday";
ALTER TABLE "WorkforceHoliday"
  ADD COLUMN "source" "WorkforceHolidaySource" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'GLOBAL';

ALTER INDEX "EfetivoHoliday_holidayDate_key" RENAME TO "WorkforceHoliday_holidayDate_key";
ALTER INDEX "EfetivoHoliday_deletedAt_holidayDate_idx" RENAME TO "WorkforceHoliday_deletedAt_holidayDate_idx";
ALTER INDEX "EfetivoHoliday_pkey" RENAME TO "WorkforceHoliday_pkey";

CREATE TABLE "WorkforceCalendarState" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkforceCalendarState_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkforceCalendarState" ("id", "revision", "createdAt", "updatedAt")
VALUES ('global', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

DROP INDEX IF EXISTS "Collaborator_jobRoleId_idx";
ALTER TABLE "Collaborator" DROP CONSTRAINT IF EXISTS "Collaborator_jobRoleId_fkey";
ALTER TABLE "Collaborator" ALTER COLUMN "jobRoleId" SET NOT NULL;
ALTER TABLE "Collaborator" DROP COLUMN "role";
ALTER TABLE "Collaborator" DROP COLUMN "epiRoleOverride";
CREATE INDEX "Collaborator_jobRoleId_idx" ON "Collaborator"("jobRoleId");

CREATE INDEX "EpiCollaboratorProfile_roleOverrideJobRoleId_idx" ON "EpiCollaboratorProfile"("roleOverrideJobRoleId");
CREATE INDEX "EpiSignatureRequest_jobRoleIdSnapshot_idx" ON "EpiSignatureRequest"("jobRoleIdSnapshot");
CREATE INDEX "Report_efetivoMissionId_idx" ON "Report"("efetivoMissionId");
CREATE INDEX "ReportCollaborator_jobRoleIdSnapshot_idx" ON "ReportCollaborator"("jobRoleIdSnapshot");
CREATE INDEX "EfetivoMissionPlan_headquartersResponsibleUserId_idx" ON "EfetivoMissionPlan"("headquartersResponsibleUserId");
CREATE INDEX "EfetivoMissionPlan_planId_projectId_scheduleStatus_mobilizationDate_returnDate_idx"
  ON "EfetivoMissionPlan"("planId", "projectId", "scheduleStatus", "mobilizationDate", "returnDate");

ALTER TABLE "Collaborator"
  ADD CONSTRAINT "Collaborator_jobRoleId_fkey"
  FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EpiCollaboratorProfile"
  ADD CONSTRAINT "EpiCollaboratorProfile_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EpiCollaboratorProfile"
  ADD CONSTRAINT "EpiCollaboratorProfile_roleOverrideJobRoleId_fkey"
  FOREIGN KEY ("roleOverrideJobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EpiSignatureRequest"
  ADD CONSTRAINT "EpiSignatureRequest_jobRoleIdSnapshot_fkey"
  FOREIGN KEY ("jobRoleIdSnapshot") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReportCollaborator"
  ADD CONSTRAINT "ReportCollaborator_jobRoleIdSnapshot_fkey"
  FOREIGN KEY ("jobRoleIdSnapshot") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EfetivoMissionPlan"
  ADD CONSTRAINT "EfetivoMissionPlan_headquartersResponsibleUserId_fkey"
  FOREIGN KEY ("headquartersResponsibleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_efetivoMissionId_fkey"
  FOREIGN KEY ("efetivoMissionId") REFERENCES "EfetivoMissionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
