ALTER TABLE "MissionWeeklyProgressTarget"
  ALTER COLUMN "plannedPctPoints" DROP NOT NULL,
  ADD COLUMN "definition" JSONB;

ALTER TABLE "MissionWeeklyProgressTarget"
  DROP CONSTRAINT "MissionWeeklyProgressTarget_value_check",
  ADD CONSTRAINT "MissionWeeklyProgressTarget_value_check" CHECK (
    "revision" > 0 AND (
      ("definition" IS NULL AND "plannedPctPoints" IS NOT NULL AND "plannedPctPoints" BETWEEN 0 AND 100)
      OR ("definition" IS NOT NULL AND "plannedPctPoints" IS NULL AND jsonb_typeof("definition") = 'object')
    )
  );
