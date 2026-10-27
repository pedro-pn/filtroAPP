-- Older schedules copied a future return/forecast into the default cycle before
-- mobilization. The earlier repair only covered missions with returnDate = NULL,
-- so schedules such as 5839 retained that forecast as an actual demobilization.
-- Only repair active official history with evidence that the end was recorded
-- before it happened. Explicit cycle edits and actual demobilizations win.
WITH candidates AS MATERIALIZED (
  SELECT cycle."id", cycle."missionId", cycle."mobilizationDate",
         cycle."demobilizationDate", mission."projectId", mission."planId",
         mission."returnDate", project."demobilizationDate" AS "projectDemobilizationDate"
  FROM "EfetivoMissionCycle" cycle
  JOIN "EfetivoMissionPlan" mission ON mission."id" = cycle."missionId"
  JOIN "EfetivoPlan" plan ON plan."id" = mission."planId"
  JOIN "Project" project ON project."id" = mission."projectId"
  WHERE cycle."isDefault"
    AND cycle."demobilizationDate" > cycle."createdAt"::date
    AND cycle."demobilizationDate" IN (mission."returnDate", mission."executionEndDate")
    AND plan."kind" = 'OFFICIAL' AND plan."status" = 'ACTIVE'
    AND project."isActive" AND project."deletedAt" IS NULL
    AND mission."deletedAt" IS NULL AND mission."scheduleStatus" <> 'CANCELLED'
    AND mission."stage" IN ('STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT')
    AND NOT EXISTS (
      SELECT 1 FROM "EfetivoMissionCycle" other
      WHERE other."missionId" = cycle."missionId" AND other."id" <> cycle."id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "EfetivoAuditEvent" event
      WHERE event."entityId" = cycle."id" AND event."action" = 'MISSION_CYCLE_UPDATE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "EfetivoAuditEvent" event
      WHERE event."entityId" = mission."id"
        AND (
          (event."action" = 'MISSION_DEMOBILIZATION_UPDATE'
            AND NULLIF(event."afterData"->>'returnDate', '') IS NOT NULL)
          OR (event."action" IN ('MISSION_UPDATE', 'MISSION_STAGE_CHANGE')
            AND event."afterData"->>'stage' IS DISTINCT FROM 'STANDBY'
            AND NULLIF(event."afterData"->>'returnDate', '') IS NOT NULL
            AND event."afterData"->>'returnDate' IS DISTINCT FROM event."beforeData"->>'returnDate')
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ProjectWorkflowEvent" event
      WHERE event."projectId" = mission."projectId" AND event."action" = 'WORKFLOW_DEMOBILIZATION'
        AND (NULLIF(event."data"->>'returnDate', '') IS NOT NULL
          OR NULLIF(event."data"->>'demobilizationDate', '') IS NOT NULL)
    )
), repaired_cycles AS (
  UPDATE "EfetivoMissionCycle" cycle
  SET "demobilizationDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  FROM candidates candidate
  WHERE cycle."id" = candidate."id"
  RETURNING cycle."id"
), repaired_individual_cycles AS (
  UPDATE "EfetivoAllocationCycle" cycle
  SET "demobilizationDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  FROM "EfetivoMissionAllocation" allocation, candidates candidate
  WHERE cycle."allocationId" = allocation."id"
    AND allocation."missionId" = candidate."missionId" AND allocation."deletedAt" IS NULL
    AND allocation."demobilizationDate" IS NULL
    AND cycle."demobilizationDate" = candidate."demobilizationDate"
    AND cycle."demobilizationDate" > cycle."createdAt"::date
    AND NOT EXISTS (
      SELECT 1 FROM "EfetivoAuditEvent" event
      WHERE (event."entityId" = cycle."id" AND event."action" IN ('ALLOCATION_CYCLE_CREATE', 'ALLOCATION_CYCLE_UPDATE'))
         OR (event."entityId" = allocation."id" AND event."action" = 'ALLOCATION_PERIOD_UPDATE')
    )
  RETURNING cycle."id", cycle."mobilizationDate", candidate."planId", candidate."demobilizationDate" AS "previousEnd"
), repaired_missions AS (
  UPDATE "EfetivoMissionPlan" mission
  SET "returnDate" = CASE WHEN mission."returnDate" = candidate."demobilizationDate" THEN NULL ELSE mission."returnDate" END,
      "version" = mission."version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM candidates candidate
  WHERE mission."id" = candidate."missionId"
  RETURNING mission."id"
), repaired_projects AS (
  UPDATE "Project" project
  SET "demobilizationDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  FROM candidates candidate
  WHERE project."id" = candidate."projectId"
    AND project."demobilizationDate"::date = candidate."demobilizationDate"
  RETURNING project."id"
), cycle_audit AS (
  INSERT INTO "EfetivoAuditEvent" ("id", "planId", "action", "entityType", "entityId", "summary", "beforeData", "afterData", "createdAt")
  SELECT 'forecast-demobilization-repair-' || candidate."id", candidate."planId",
         'MISSION_FORECAST_DEMOBILIZATION_REPAIR', 'MISSION_CYCLE', candidate."id",
         'Previsão antiga removida da desmobilização efetiva; ciclo mantido aberto até o registro da saída.',
         jsonb_build_object('demobilizationDate', candidate."demobilizationDate", 'returnDate', candidate."returnDate", 'projectDemobilizationDate', candidate."projectDemobilizationDate"),
         jsonb_build_object('demobilizationDate', NULL, 'mobilizationDate', candidate."mobilizationDate"),
         CURRENT_TIMESTAMP
  FROM candidates candidate JOIN repaired_cycles repaired ON repaired."id" = candidate."id"
  RETURNING "id"
), individual_audit AS (
  INSERT INTO "EfetivoAuditEvent" ("id", "planId", "action", "entityType", "entityId", "summary", "beforeData", "afterData", "createdAt")
  SELECT 'forecast-demobilization-repair-' || cycle."id", cycle."planId",
         'ALLOCATION_FORECAST_DEMOBILIZATION_REPAIR', 'ALLOCATION_CYCLE', cycle."id",
         'Previsão herdada removida do ciclo individual; encerramentos registrados pelo planejador foram preservados.',
         jsonb_build_object('demobilizationDate', cycle."previousEnd"),
         jsonb_build_object('demobilizationDate', NULL, 'mobilizationDate', cycle."mobilizationDate"),
         CURRENT_TIMESTAMP
  FROM repaired_individual_cycles cycle
  RETURNING "id"
)
UPDATE "EfetivoPlan" plan
SET "revision" = plan."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE plan."id" IN (SELECT "planId" FROM candidates);
