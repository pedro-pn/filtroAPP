CREATE TABLE "MissionWeeklyProgressTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "groupId" TEXT,
    "weekStartDate" DATE NOT NULL,
    "plannedPctPoints" DECIMAL(5,2) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MissionWeeklyProgressTarget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MissionWeeklyProgressTarget_owner_check" CHECK (("projectId" IS NOT NULL) <> ("groupId" IS NOT NULL)),
    CONSTRAINT "MissionWeeklyProgressTarget_week_check" CHECK (EXTRACT(ISODOW FROM "weekStartDate") = 1),
    CONSTRAINT "MissionWeeklyProgressTarget_value_check" CHECK ("plannedPctPoints" BETWEEN 0 AND 100 AND "revision" > 0)
);
CREATE UNIQUE INDEX "MissionWeeklyProgressTarget_project_week_revision_key" ON "MissionWeeklyProgressTarget"("projectId", "weekStartDate", "revision");
CREATE UNIQUE INDEX "MissionWeeklyProgressTarget_group_week_revision_key" ON "MissionWeeklyProgressTarget"("groupId", "weekStartDate", "revision");
CREATE INDEX "MissionWeeklyProgressTarget_createdByUserId_idx" ON "MissionWeeklyProgressTarget"("createdByUserId");
ALTER TABLE "MissionWeeklyProgressTarget" ADD CONSTRAINT "MissionWeeklyProgressTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionWeeklyProgressTarget" ADD CONSTRAINT "MissionWeeklyProgressTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AcompanhamentoMissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionWeeklyProgressTarget" ADD CONSTRAINT "MissionWeeklyProgressTarget_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
