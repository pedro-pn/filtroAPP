/*
  Warnings:

  - You are about to drop the column `isActive` on the `Unit` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX IF EXISTS "QualityRecord_natureId_eventDate_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "QualityRecord_projectId_type_deletedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "ReportDraft_projectId_idx";

-- DropIndex
DROP INDEX IF EXISTS "ReportDraft_userId_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "clientSigners" JSONB[] DEFAULT ARRAY[]::JSONB[];

-- AlterTable
ALTER TABLE "RomaneioCatalogSyncState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Unit" DROP COLUMN IF EXISTS "isActive";

-- RenameIndex
ALTER INDEX IF EXISTS "CalibrationNotificationLog_equipmentType_equipmentId_milestone_" RENAME TO "CalibrationNotificationLog_equipmentType_equipmentId_milest_key";
