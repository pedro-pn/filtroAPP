ALTER TABLE "User"
  ADD COLUMN "notifyCalibrationRemindersByEmail" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CalibrationNotificationLog" (
  "id" TEXT NOT NULL,
  "equipmentType" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "milestone" TEXT NOT NULL,
  "targetDate" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CalibrationNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalibrationNotificationLog_equipmentType_equipmentId_milestone_targetDate_key"
  ON "CalibrationNotificationLog"("equipmentType", "equipmentId", "milestone", "targetDate");

CREATE INDEX "CalibrationNotificationLog_category_milestone_sentAt_idx"
  ON "CalibrationNotificationLog"("category", "milestone", "sentAt");
