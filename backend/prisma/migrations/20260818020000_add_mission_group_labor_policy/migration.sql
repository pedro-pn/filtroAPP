CREATE TYPE "AcompanhamentoLaborAllocationMode" AS ENUM (
  'VISUAL_ONLY',
  'SHARED_EXECUTION',
  'CONSOLIDATE_PRIMARY'
);

ALTER TABLE "AcompanhamentoMissionGroup"
  ADD COLUMN "laborAllocationMode" "AcompanhamentoLaborAllocationMode" NOT NULL DEFAULT 'VISUAL_ONLY',
  ADD COLUMN "primaryLaborProjectId" TEXT;

-- Política aprovada para as frentes UHE executadas simultaneamente no mesmo local.
UPDATE "AcompanhamentoMissionGroup" AS group_row
SET "laborAllocationMode" = 'SHARED_EXECUTION'
WHERE group_row."status" = 'ACTIVE'
  AND (
    SELECT COUNT(*)
    FROM "AcompanhamentoMissionGroupMember" AS member
    JOIN "Project" AS project ON project."id" = member."projectId"
    WHERE member."groupId" = group_row."id"
      AND project."code" IN ('5694', '5810', '5813')
  ) >= 2
  AND NOT EXISTS (
    SELECT 1
    FROM "AcompanhamentoMissionGroupMember" AS member
    JOIN "Project" AS project ON project."id" = member."projectId"
    WHERE member."groupId" = group_row."id"
      AND project."code" NOT IN ('5694', '5810', '5813')
  );

-- Exceção Detroit: RDOs paralelos históricos são consolidados uma única vez na 5761.
UPDATE "AcompanhamentoMissionGroup" AS group_row
SET
  "laborAllocationMode" = 'CONSOLIDATE_PRIMARY',
  "primaryLaborProjectId" = primary_project."id"
FROM "Project" AS primary_project
WHERE group_row."status" = 'ACTIVE'
  AND primary_project."code" = '5761'
  AND EXISTS (
    SELECT 1
    FROM "AcompanhamentoMissionGroupMember" AS member
    WHERE member."groupId" = group_row."id"
      AND member."projectId" = primary_project."id"
  )
  AND (
    SELECT COUNT(*)
    FROM "AcompanhamentoMissionGroupMember" AS member
    JOIN "Project" AS project ON project."id" = member."projectId"
    WHERE member."groupId" = group_row."id"
      AND project."code" IN ('5761', '5788', '5794', '5805')
  ) >= 2
  AND NOT EXISTS (
    SELECT 1
    FROM "AcompanhamentoMissionGroupMember" AS member
    JOIN "Project" AS project ON project."id" = member."projectId"
    WHERE member."groupId" = group_row."id"
      AND project."code" NOT IN ('5761', '5788', '5794', '5805')
  );

CREATE INDEX "AcompanhamentoMissionGroup_laborAllocationMode_idx"
  ON "AcompanhamentoMissionGroup"("laborAllocationMode");

CREATE INDEX "AcompanhamentoMissionGroup_primaryLaborProjectId_idx"
  ON "AcompanhamentoMissionGroup"("primaryLaborProjectId");

ALTER TABLE "AcompanhamentoMissionGroup"
  ADD CONSTRAINT "AcompanhamentoMissionGroup_primaryLaborProjectId_fkey"
  FOREIGN KEY ("primaryLaborProjectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "PontoDayProjectOverride_collaboratorId_workDate_key";

CREATE UNIQUE INDEX "PontoDayProjectOverride_collaboratorId_workDate_projectId_key"
  ON "PontoDayProjectOverride"("collaboratorId", "workDate", "projectId");

CREATE INDEX "PontoDayProjectOverride_collaboratorId_workDate_idx"
  ON "PontoDayProjectOverride"("collaboratorId", "workDate");
