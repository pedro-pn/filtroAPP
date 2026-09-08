CREATE TABLE "PontoDayProjectOverride" (
    "id" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "projectId" TEXT NOT NULL,
    "externalEmployeeId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PontoDayProjectOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PontoDayProjectOverride_collaboratorId_workDate_key"
ON "PontoDayProjectOverride"("collaboratorId", "workDate");

CREATE INDEX "PontoDayProjectOverride_projectId_idx"
ON "PontoDayProjectOverride"("projectId");

CREATE INDEX "PontoDayProjectOverride_externalEmployeeId_workDate_idx"
ON "PontoDayProjectOverride"("externalEmployeeId", "workDate");

ALTER TABLE "PontoDayProjectOverride"
ADD CONSTRAINT "PontoDayProjectOverride_collaboratorId_fkey"
FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PontoDayProjectOverride"
ADD CONSTRAINT "PontoDayProjectOverride_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
