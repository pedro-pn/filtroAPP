ALTER TABLE "ProjectWorkflow"
ADD COLUMN "travelPlan" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "preJobScheduledDate" DATE,
ADD COLUMN "preJobCompletedDate" DATE;

-- Preserve the date recorded on the former scheduled checklist.
UPDATE "ProjectWorkflow" workflow
SET "preJobScheduledDate" = legacy."updatedAt"::date
FROM "ProjectWorkflowChecklist" legacy
WHERE legacy."projectId" = workflow."projectId"
  AND legacy."key" = 'D15_PRE_JOB_SCHEDULED'
  AND legacy."status" IN ('DONE', 'NOT_APPLICABLE');

-- A fully resolved former pre-job becomes a realized pre-job on its last update.
UPDATE "ProjectWorkflow" workflow
SET "preJobCompletedDate" = completed."completedDate"
FROM (
    SELECT "projectId", MAX("updatedAt")::date AS "completedDate"
    FROM "ProjectWorkflowChecklist"
    WHERE "key" IN (
        'D15_PRE_JOB_SCHEDULED',
        'D15_PRE_JOB_SCOPE_PRESENTED',
        'D15_PRE_JOB_PROPOSAL_REVIEWED',
        'D15_PRE_JOB_RESPONSIBILITIES_EXPLAINED',
        'D15_PRE_JOB_CRITICAL_POINTS_EXPLAINED',
        'D15_PRE_JOB_SCHEDULE_PRESENTED',
        'D15_PRE_JOB_RISKS_PRESENTED',
        'D15_PRE_JOB_FIELD_LEAD_DEFINED'
    )
      AND "status" IN ('DONE', 'NOT_APPLICABLE')
    GROUP BY "projectId"
    HAVING COUNT(DISTINCT "key") = 8
) completed
WHERE completed."projectId" = workflow."projectId";

-- Carry forward the portions of the former travel checklist that have an
-- unambiguous structured equivalent. Departure date and time still require
-- confirmation in the new fields.
UPDATE "ProjectWorkflow" workflow
SET "travelPlan" = jsonb_strip_nulls(jsonb_build_object(
    'lodgingRequestedDate', (
        SELECT to_char(checklist."updatedAt"::date, 'YYYY-MM-DD')
        FROM "ProjectWorkflowChecklist" checklist
        WHERE checklist."projectId" = workflow."projectId"
          AND checklist."key" = 'D15_TRAVEL_LODGING_REQUESTED'
          AND checklist."status" = 'DONE'
        LIMIT 1
    ),
    'lodgingConfirmedDate', (
        SELECT to_char(checklist."updatedAt"::date, 'YYYY-MM-DD')
        FROM "ProjectWorkflowChecklist" checklist
        WHERE checklist."projectId" = workflow."projectId"
          AND checklist."key" = 'D15_TRAVEL_LODGING_CONFIRMED'
          AND checklist."status" = 'DONE'
        LIMIT 1
    ),
    'teamTransportDefined', (
        SELECT CASE checklist."status" WHEN 'DONE' THEN true WHEN 'NOT_APPLICABLE' THEN false END
        FROM "ProjectWorkflowChecklist" checklist
        WHERE checklist."projectId" = workflow."projectId"
          AND checklist."key" = 'D15_TRAVEL_TEAM_TRANSPORT_DEFINED'
        LIMIT 1
    ),
    'teamTransportDescription', (
        SELECT NULLIF(checklist."note", '')
        FROM "ProjectWorkflowChecklist" checklist
        WHERE checklist."projectId" = workflow."projectId"
          AND checklist."key" = 'D15_TRAVEL_TEAM_TRANSPORT_DEFINED'
          AND checklist."status" = 'DONE'
        LIMIT 1
    ),
    'freightDefined', CASE
        WHEN EXISTS (
            SELECT 1 FROM "ProjectWorkflowChecklist" checklist
            WHERE checklist."projectId" = workflow."projectId"
              AND checklist."key" IN ('D15_TRAVEL_FREIGHT_REQUESTED', 'D15_TRAVEL_COMPANY_TRUCK_RESERVED')
              AND checklist."status" = 'DONE'
        ) THEN true
        WHEN (
            SELECT COUNT(*) FROM "ProjectWorkflowChecklist" checklist
            WHERE checklist."projectId" = workflow."projectId"
              AND checklist."key" IN ('D15_TRAVEL_FREIGHT_REQUESTED', 'D15_TRAVEL_COMPANY_TRUCK_RESERVED')
              AND checklist."status" = 'NOT_APPLICABLE'
        ) = 2 THEN false
        ELSE NULL
    END,
    'freightType', CASE
        WHEN EXISTS (
            SELECT 1 FROM "ProjectWorkflowChecklist" checklist
            WHERE checklist."projectId" = workflow."projectId"
              AND checklist."key" = 'D15_TRAVEL_COMPANY_TRUCK_RESERVED'
              AND checklist."status" = 'DONE'
        ) THEN 'OWN'
        WHEN EXISTS (
            SELECT 1 FROM "ProjectWorkflowChecklist" checklist
            WHERE checklist."projectId" = workflow."projectId"
              AND checklist."key" = 'D15_TRAVEL_FREIGHT_REQUESTED'
              AND checklist."status" = 'DONE'
        ) THEN 'THIRD_PARTY'
        ELSE NULL
    END
))
WHERE EXISTS (
    SELECT 1 FROM "ProjectWorkflowChecklist" checklist
    WHERE checklist."projectId" = workflow."projectId"
      AND checklist."key" LIKE 'D15_TRAVEL_%'
);
