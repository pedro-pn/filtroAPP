ALTER TABLE "Project" ADD COLUMN "defaultReportResponsibleUserId" TEXT;

ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultReportResponsibleUserId_fkey"
  FOREIGN KEY ("defaultReportResponsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
