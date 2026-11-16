ALTER TABLE "Project"
  ADD COLUMN "progressModel" TEXT NOT NULL DEFAULT 'QUANTITIES',
  ADD COLUMN "plannedCollaborators" INTEGER;

ALTER TABLE "Project" ADD CONSTRAINT "Project_progressModel_check"
  CHECK ("progressModel" IN ('QUANTITIES', 'WORKED_DAYS'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_plannedCollaborators_check"
  CHECK (("plannedCollaborators" IS NULL OR "plannedCollaborators" > 0)
    AND ("progressModel" <> 'WORKED_DAYS' OR "plannedCollaborators" IS NOT NULL));
