ALTER TABLE "ProjectWorkflow" ADD COLUMN "actualMobilizationDate" DATE;
ALTER TABLE "EfetivoMissionCycle" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- The initial cycle is stable even when its mobilization date is corrected.
WITH initial_cycles AS (
  SELECT DISTINCT ON ("missionId") "id"
  FROM "EfetivoMissionCycle"
  ORDER BY "missionId", "createdAt", "mobilizationDate", "id"
)
UPDATE "EfetivoMissionCycle" cycle
SET "isDefault" = true
FROM initial_cycles initial
WHERE cycle."id" = initial."id";

CREATE UNIQUE INDEX "EfetivoMissionCycle_default_key"
  ON "EfetivoMissionCycle" ("missionId") WHERE "isDefault";

-- Only remove automatically copied ends of active cycles. Preserve explicit cycle
-- edits, effective demobilizations recorded in the workflow and completed history.
UPDATE "EfetivoMissionCycle" cycle
SET "demobilizationDate" = NULL
FROM "EfetivoMissionPlan" mission
WHERE cycle."missionId" = mission."id"
  AND cycle."isDefault"
  AND mission."stage" IN ('STANDBY', 'MOBILIZATION', 'EXECUTION')
  AND mission."returnDate" IS NULL
  AND cycle."demobilizationDate" = mission."executionEndDate"
  AND NOT EXISTS (
    SELECT 1 FROM "EfetivoAuditEvent" event
    WHERE event."entityId" = cycle."id" AND event."action" = 'MISSION_CYCLE_UPDATE'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectWorkflowEvent" event
    WHERE event."projectId" = mission."projectId"
      AND event."action" = 'WORKFLOW_DEMOBILIZATION'
      AND NULLIF(COALESCE(event."data"->>'returnDate', event."data"->>'demobilizationDate'), '') IS NOT NULL
  );

UPDATE "EfetivoAllocationCycle" cycle
SET "demobilizationDate" = NULL
FROM "EfetivoMissionAllocation" allocation, "EfetivoMissionPlan" mission
WHERE cycle."allocationId" = allocation."id" AND allocation."missionId" = mission."id"
  AND mission."stage" IN ('STANDBY', 'MOBILIZATION', 'EXECUTION')
  AND mission."returnDate" IS NULL
  AND cycle."demobilizationDate" = mission."executionEndDate"
  AND NOT EXISTS (
    SELECT 1 FROM "EfetivoAuditEvent" event
    WHERE (event."entityId" = cycle."id" AND event."action" IN ('ALLOCATION_CYCLE_CREATE', 'ALLOCATION_CYCLE_UPDATE'))
       OR (event."entityId" = allocation."id" AND event."action" = 'ALLOCATION_PERIOD_UPDATE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectWorkflowEvent" event
    WHERE event."projectId" = mission."projectId" AND event."action" = 'WORKFLOW_DEMOBILIZATION'
      AND NULLIF(event."data"->>'returnDate', '') IS NOT NULL
  );
