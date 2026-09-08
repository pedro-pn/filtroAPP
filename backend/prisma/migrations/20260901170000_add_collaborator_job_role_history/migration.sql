CREATE TABLE "CollaboratorJobRoleHistory" (
    "id" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaboratorJobRoleHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollaboratorJobRoleHistory_collaboratorId_effectiveDate_key"
ON "CollaboratorJobRoleHistory"("collaboratorId", "effectiveDate");

CREATE INDEX "CollaboratorJobRoleHistory_collaboratorId_effectiveDate_idx"
ON "CollaboratorJobRoleHistory"("collaboratorId", "effectiveDate");

CREATE INDEX "CollaboratorJobRoleHistory_jobRoleId_effectiveDate_idx"
ON "CollaboratorJobRoleHistory"("jobRoleId", "effectiveDate");

ALTER TABLE "CollaboratorJobRoleHistory"
ADD CONSTRAINT "CollaboratorJobRoleHistory_collaboratorId_fkey"
FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaboratorJobRoleHistory"
ADD CONSTRAINT "CollaboratorJobRoleHistory_jobRoleId_fkey"
FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CollaboratorJobRoleHistory" (
    "id", "collaboratorId", "jobRoleId", "effectiveDate", "createdAt", "updatedAt"
)
SELECT
    'role-history-' || md5("id" || ':' || COALESCE("admissionDate", "createdAt")::date::text),
    "id",
    "jobRoleId",
    COALESCE("admissionDate", "createdAt")::date,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Collaborator";
