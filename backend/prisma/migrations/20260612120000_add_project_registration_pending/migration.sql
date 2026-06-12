ALTER TABLE "Project"
ADD COLUMN "registrationPending" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Project_registrationPending_idx"
ON "Project"("registrationPending");
