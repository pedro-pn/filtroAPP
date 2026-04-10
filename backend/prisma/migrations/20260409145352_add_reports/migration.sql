-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL DEFAULT 'RDO',
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reportDate" TIMESTAMP(3) NOT NULL,
    "arrivalTime" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "lunchBreak" TEXT NOT NULL,
    "daytimeCount" INTEGER NOT NULL,
    "overtimeReason" TEXT,
    "dailyDescription" TEXT,
    "specialConditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCollaborator" (
    "reportId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,

    CONSTRAINT "ReportCollaborator_pkey" PRIMARY KEY ("reportId","collaboratorId")
);

-- CreateTable
CREATE TABLE "ReportService" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "equipmentId" TEXT,
    "system" TEXT,
    "material" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "finalized" BOOLEAN,
    "extraData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportService_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCollaborator" ADD CONSTRAINT "ReportCollaborator_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCollaborator" ADD CONSTRAINT "ReportCollaborator_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportService" ADD CONSTRAINT "ReportService_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportService" ADD CONSTRAINT "ReportService_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
