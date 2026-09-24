CREATE TABLE "ProjectExecutionWeeklyReview" (
    "projectId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExecutionWeeklyReview_pkey" PRIMARY KEY ("projectId","weekStartDate")
);

CREATE INDEX "ProjectExecutionWeeklyReview_projectId_completedAt_idx" ON "ProjectExecutionWeeklyReview"("projectId","completedAt");
CREATE INDEX "ProjectExecutionWeeklyReview_completedByUserId_idx" ON "ProjectExecutionWeeklyReview"("completedByUserId");

ALTER TABLE "ProjectExecutionWeeklyReview" ADD CONSTRAINT "ProjectExecutionWeeklyReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectExecutionWeeklyReview" ADD CONSTRAINT "ProjectExecutionWeeklyReview_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
